from flask import Flask, request, jsonify
from db_utils import connect_db, get_db_schema, execute_sql
from summary_utils import generate_summary
from ollama_utils import ask_ollama
import logging

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s in %(module)s: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

app = Flask(__name__)

# 用大模型自动生成SQL
SYSTEM_PROMPT = """
你是一个sqlite数据库分析助手。用户会用中文提出分析需求，你需要根据以下数据库结构，将用户问题转成标准SQL语句（只输出SQL，不要解释和多余内容）：

【数据库结构】
{schema}

【输出格式】
只输出一条标准、可直接执行的 SQL 语句。
"""

def generate_sql_by_llm(user_question, schema):
    prompt = SYSTEM_PROMPT.format(schema=schema) + f"\n用户需求：{user_question}"
    sql = ask_ollama(prompt)
    return sql.strip().split(';')[0] + ';'

@app.route('/ai/ask', methods=['POST'])
def ai_ask():
    data = request.json
    logging.info('收到AI请求: %s', data)
    user_question = data.get('user_question')
    sql = data.get('sql')
    rows = data.get('rows')
    columns = data.get('columns')
    conn = connect_db()
    schema = get_db_schema(conn)
    # 自动生成SQL
    if not sql:
        sql = generate_sql_by_llm(user_question, schema)
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
    try:
        reply = generate_summary(user_question, sql, rows, columns)
        logging.info('AI回复: %s', reply)
        return jsonify({'reply': reply, 'sql': sql, 'columns': columns, 'rows': rows})
    except Exception as e:
        logging.exception('AI处理异常:')
        return jsonify({'reply': 'AI内部错误: %s' % str(e)}), 500

if __name__ == '__main__':
    logging.info('启动 Flask AI 服务...')
    app.run(host='127.0.0.1', port=5001, debug=True)
