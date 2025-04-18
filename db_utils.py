import sqlite3

DB_PATH = "keyboard_stats.db"

def connect_db(db_path=DB_PATH):
    return sqlite3.connect(db_path)

def get_db_schema(conn):
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = cursor.fetchall()
    schema = []
    for (table_name,) in tables:
        cursor.execute(f"PRAGMA table_info({table_name});")
        columns = cursor.fetchall()
        col_desc = ", ".join([f"{col[1]} ({col[2]})" for col in columns])
        schema.append(f"表 {table_name}: {col_desc}")
    return "\n".join(schema)

def execute_sql(conn, sql):
    cursor = conn.execute(sql)
    columns = [desc[0] for desc in cursor.description]
    rows = cursor.fetchall()
    return rows, columns