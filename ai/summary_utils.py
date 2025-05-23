from ollama_utils import ask_ollama

def generate_summary(user_question, sql, rows, columns):
    """
    用AI根据用户需求、SQL和查询结果，生成有趣的中文总结。
    """
    # 将结果转为表格文本
    if not rows:
        table_text = "（无查询结果）"
    else:
        table_text = " | ".join(columns) + "\n"
        table_text += "-" * 30 + "\n"
        for row in rows:
            table_text += " | ".join(str(x) for x in row) + "\n"

    prompt = f"""
    ### please only use chinese to manser my question!!!!
你是一个数据库分析助手。请根据以下信息，用中文生成一段简洁有趣的分析总结，风格可以幽默、鼓励、调侃，适合普通用户阅读。

【用户需求】
{user_question}

【SQL语句】
{sql}

【查询结果】
{table_text}
"""
    return ask_ollama(prompt)