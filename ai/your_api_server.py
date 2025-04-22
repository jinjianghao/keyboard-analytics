from flask import Flask, request, jsonify
from db_utils import connect_db, get_db_schema, execute_sql
from summary_utils import generate_summary
from ollama_utils import ask_ollama
from translate_utils import translate_zh2en
import logging
import re

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s in %(module)s: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

app = Flask(__name__)

# 英文结构翻译辅助
def translate_schema_to_en(schema):
    return '\n'.join([translate_zh2en(line) for line in schema.split('\n')])

# SQL危险检测
DANGEROUS_SQL_PATTERNS = [r"drop ", r"delete ", r"truncate ", r"alter ", r"update "]
def is_dangerous_sql(sql):
    sql_l = sql.lower()
    return any(re.search(pat, sql_l) for pat in DANGEROUS_SQL_PATTERNS)

# SQL兼容性修正（可根据实际需要扩展）
def fix_sql_compat(sql):
    # DuckDB/SQLite日期函数兼容
    sql = sql.replace("CURRENT_DATE", "date('now', 'localtime')")
    # 其它兼容性修正可扩展
    return sql

# 用大模型自动生成SQL
SYSTEM_PROMPT = """
你是一个sqlite数据库分析助手。用户提出分析需求，你需要根据以下数据库结构，将用户问题转成标准SQL语句（只输出SQL，不要解释和多余内容）：

【数据库结构】
{schema}

【注意事项】
- 查询日期请优先使用date字段，date字段格式为yyyy-mm-dd。
- 不要用timestamp字段判断日期。

【输出格式】
只输出一条标准、可直接执行的 SQL 语句。
"""

def generate_sql_by_llm(user_question, schema, model="duckdb-nsql"):
    # 若模型为 duckdb-nsql，先翻译
    if model == "duckdb-nsql":
        schema_en = translate_schema_to_en(schema)
        user_question_en = translate_zh2en(user_question)
        prompt = SYSTEM_PROMPT.format(schema=schema_en) + f"\nUser requirement: {user_question_en}"
        sql = ask_ollama(prompt, system_prompt=None)
    else:
        prompt = SYSTEM_PROMPT.format(schema=schema) + f"\n用户需求：{user_question}"
        sql = ask_ollama(prompt, system_prompt=None)
    sql = sql.strip().split(';')[0] + ';'
    sql = fix_sql_compat(sql)
    if is_dangerous_sql(sql):
        raise ValueError("检测到危险SQL语句，已阻止执行！")
    return sql

@app.route('/ai/ask', methods=['POST'])
def ai_ask():
    try:
        data = request.json
        logging.info('收到AI请求: %s', data)
        user_question = data.get('user_question')
        sql = data.get('sql')
        rows = data.get('rows')
        columns = data.get('columns')
        model = data.get('model', 'duckdb-nsql')
        conn = connect_db()
        schema = get_db_schema(conn)
        # 自动生成SQL
        if not sql:
            sql = generate_sql_by_llm(user_question, schema, model=model)
            logging.info('自动生成SQL: %s', sql)
        # 自动查数据
        if not (rows and columns):
            try:
                rows, columns = execute_sql(conn, sql)
                logging.info('自动查数据 rows/columns')
            except Exception as e:
                logging.warning('SQL执行失败: %s', e)
                rows, columns = [], []
        conn.close()
        # 结果摘要
        row_count = len(rows) if rows else 0
        reply = generate_summary(user_question, sql, rows, columns)
        logging.info('AI回复: %s', reply)
        return jsonify({'reply': reply, 'sql': sql, 'columns': columns, 'rows': rows, 'row_count': row_count})
    except ValueError as ve:
        logging.error('SQL安全校验失败: %s', ve)
        return jsonify({'reply': str(ve), 'sql': '', 'columns': [], 'rows': []}), 400
    except Exception as e:
        logging.exception('AI处理异常:')
        return jsonify({'reply': 'AI内部错误: %s' % str(e)}), 500

if __name__ == '__main__':
    logging.info('启动 Flask AI 服务...')
    app.run(host='127.0.0.1', port=5001, debug=True)
