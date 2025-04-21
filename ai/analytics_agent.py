from db_utils import connect_db, get_db_schema, execute_sql
from ollama_utils import ask_ollama
from summary_utils import generate_summary

def pretty_print(rows, columns):
    if not rows:
        print("没有查询到数据。")
        return
    col_widths = [max(len(str(col)), max(len(str(row[idx])) for row in rows)) for idx, col in enumerate(columns)]
    header = " | ".join(str(col).ljust(col_widths[idx]) for idx, col in enumerate(columns))
    print(header)
    print("-" * len(header))
    for row in rows:
        print(" | ".join(str(row[idx]).ljust(col_widths[idx]) for idx in range(len(columns))))

def main():
    print("欢迎使用本地AI数据库分析助手（Ollama版）")
    print("输入自然语言问题，或直接输入SQL语句。输入 exit 退出。")
    print("----------------------------------------------------------")

    conn = connect_db()
    schema = get_db_schema(conn)
    print("数据库结构如下：")
    print(schema)
    print("----------------------------------------------------------")

    system_prompt = """
你是一个sqlite数据库分析助手。用户会用中文提出分析需求，你需要根据以下数据库结构，将用户问题转成标准SQL语句（只输出SQL，不要解释和多余内容）：

表 normal_keys: 
- id (INTEGER, 主键，自增)
- key (TEXT, 按键名，唯一)
- count (INTEGER, 按键次数)
- timestamp (DATETIME, 默认当前时间)

表 shortcut_keys: 
- id (INTEGER, 主键，自增)
- combination (TEXT, 组合键名，唯一)
- count (INTEGER, 次数)
- timestamp (DATETIME, 默认当前时间)

表 mouse_events: 
- id (INTEGER, 主键，自增)
- button (TEXT, 鼠标按钮名，唯一)
- count (INTEGER, 次数)
- timestamp (DATETIME, 默认当前时间)

注意：只允许使用上述字段。不要生成不存在的字段。SQL请尽量简洁。
"""

    while True:
        user_input = input("\n请输入你的分析需求（或直接输入SQL）：\n> ").strip()
        if user_input.lower() in ["exit", "quit", "退出"]:
            print("感谢使用，再见！")
            break
        if user_input.lower().startswith("select") or user_input.lower().startswith("with"):
            sql = user_input
        else:
            print("正在调用本地AI模型生成SQL，请稍候...")
            prompt = f"将下面这个需求转成sqlite SQL查询语句，只输出SQL，不要解释：{user_input}"
            sql = ask_ollama(prompt, system_prompt).strip()
            sql = sql.split(";")[0] + ";"
            print(f"\nAI生成的SQL:\n{sql}")

        try:
            rows, columns = execute_sql(conn, sql)
            pretty_print(rows, columns)
            # 生成有趣总结
            print("\nAI分析总结：")
            summary = generate_summary(user_input, sql, rows, columns)
            print(summary.strip())
        except Exception as e:
            print(f"SQL执行失败: {e}")

if __name__ == "__main__":
    main()