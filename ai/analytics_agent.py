from db_utils import connect_db, get_db_schema, execute_sql
from ollama_utils import ask_ollama
from summary_utils import generate_summary
import datetime

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

【数据库结构】
表 normal_keys: 
- id (INTEGER, 主键，自增)
- key (TEXT, 按键名)
- count (INTEGER, 按键次数)
- date (TEXT, 日期，格式yyyy-mm-dd)
- timestamp (DATETIME, 默认当前时间)
- 唯一约束: (key, date)

表 shortcut_keys: 
- id (INTEGER, 主键，自增)
- combination (TEXT, 组合键名)
- count (INTEGER, 次数)
- date (TEXT, 日期，格式yyyy-mm-dd)
- timestamp (DATETIME, 默认当前时间)
- 唯一约束: (combination, date)

表 mouse_events: 
- id (INTEGER, 主键，自增)
- button (TEXT, 鼠标按钮名)
- count (INTEGER, 次数)
- date (TEXT, 日期，格式yyyy-mm-dd)
- timestamp (DATETIME, 默认当前时间)
- 唯一约束: (button, date)

【常见查询需求举例】
- “昨天有几次鼠标点击？” → 先查最大日期，再查该日数据
- “最近7天每种按钮点击次数” → 按日期范围聚合
- “全部数据汇总” → 按日期聚合、降序排列
- “昨天我都按了什么键？” → 查询最大日期那一天所有 key，推荐用 SELECT DISTINCT key
- “昨天每个键按了几次？” → 查询最大日期那一天所有 key 及 count
- “今天我按键最多的是哪个？” → SELECT key, count FROM normal_keys WHERE date = (SELECT MAX(date) FROM normal_keys) ORDER BY count DESC LIMIT 1
- “今天每个键按了几次？” → SELECT key, count FROM normal_keys WHERE date = (SELECT MAX(date) FROM normal_keys) ORDER BY count DESC

【优化要求】
1. SQL 必须简洁明了，避免冗余子查询与无用条件。
2. 查询“昨天”或“最近一天”时，优先用 (SELECT MAX(date) FROM 表名) 替代 DATE('now', '-1 day')
3. 查询“最近N天”，用 date >= (SELECT MAX(date) FROM 表名, 计算N天前)
4. 查询某天所有按键，使用 SELECT DISTINCT key FROM normal_keys WHERE date = (SELECT MAX(date) FROM normal_keys)
5. 查询某天每个按键的次数，用 SELECT key, count FROM normal_keys WHERE date = (SELECT MAX(date) FROM normal_keys)
6. 对于“最多/最少/最大/最小”等描述，使用 ORDER BY + LIMIT 1 实现排序取极值。
7. 遇到模糊需求时，优先返回最有代表性、最常用的 SQL
8. 只允许用表结构中已有字段
9. 不要生成不存在的字段或表
10. 只输出 SQL 语句本身，不要解释和多余内容

【输出格式】
只输出一条标准、可直接执行的 SQL 语句。
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
            if not rows:
                print("\n未查询到相关数据，以下为今日数据分析：")
                today = datetime.date.today().isoformat()
                # 查询三张表今日数据
                for table, desc in [("mouse_events", "鼠标事件"), ("normal_keys", "普通按键"), ("shortcut_keys", "快捷键")]:
                    today_sql = f"SELECT * FROM {table} WHERE date = '{today}'"
                    t_rows, t_columns = execute_sql(conn, today_sql)
                    print(f"\n【{desc} 今日数据】")
                    pretty_print(t_rows, t_columns)
        except Exception as e:
            print(f"SQL执行失败: {e}")

if __name__ == "__main__":
    main()