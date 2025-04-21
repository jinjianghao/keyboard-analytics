from flask import Flask, request, jsonify
from summary_utils import generate_summary
import logging

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s in %(module)s: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

app = Flask(__name__)

@app.route('/ai/ask', methods=['POST'])
def ai_ask():
    data = request.json
    logging.info('收到AI请求: %s', data)
    user_question = data.get('user_question')
    sql = data.get('sql', '')
    rows = data.get('rows', [])
    columns = data.get('columns', [])
    logging.info('user_question: %s', user_question)
    logging.info('sql: %s', sql)
    logging.info('rows: %s', rows)
    logging.info('columns: %s', columns)
    # 检查 rows/columns 是否为空，若为空则主动查数据库
    if not rows or not columns:
        try:
            from db_utils import get_today_stats
            stats = get_today_stats()
            if stats:
                rows = [stats]
                columns = list(stats.keys())
                logging.info('自动补充今日数据 rows/columns')
        except Exception as e:
            logging.warning('自动补充今日数据失败: %s', e)
    try:
        reply = generate_summary(user_question, sql, rows, columns)
        logging.info('AI回复: %s', reply)
        return jsonify({'reply': reply})
    except Exception as e:
        logging.exception('AI处理异常:')
        return jsonify({'reply': 'AI内部错误: %s' % str(e)}), 500

if __name__ == '__main__':
    logging.info('启动 Flask AI 服务...')
    app.run(host='127.0.0.1', port=5001, debug=True)
