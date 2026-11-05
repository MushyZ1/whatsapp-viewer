"""Read-only diagnostic: which message_type codes does YOUR msgstore.db use?

    python tools/msgtype_diagnostic.py path/to/msgstore.db

Prints counts only (no message text, names or numbers), so the output is safe to paste back.
"""
import sqlite3, sys

def main(path):
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    cur = con.cursor()
    print("message_type | rows | rows with text | rows with media")
    q = """SELECT m.message_type, COUNT(*),
                  SUM(CASE WHEN m.text_data IS NOT NULL AND m.text_data <> '' THEN 1 ELSE 0 END),
                  SUM(CASE WHEN mm.message_row_id IS NOT NULL THEN 1 ELSE 0 END)
           FROM message m LEFT JOIN message_media mm ON mm.message_row_id = m._id
           GROUP BY m.message_type ORDER BY 2 DESC"""
    for r in cur.execute(q):
        print(f"{r[0]!s:>12} | {r[1]:>6} | {r[2]:>6} | {r[3]:>6}")
    tables = {r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    for t in ("message_system", "message_revoked"):
        print(f"\ntable {t}: {'present' if t in tables else 'absent'}")
    if "message_system" in tables:
        print("message_system.action_type | rows")
        for r in cur.execute("SELECT action_type, COUNT(*) FROM message_system GROUP BY 1 ORDER BY 2 DESC"):
            print(f"{r[0]!s:>26} | {r[1]:>6}")
    print("\nmime types among stickers-looking media (image/webp):",
          cur.execute("SELECT COUNT(*) FROM message_media WHERE mime_type='image/webp'").fetchone()[0])

if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
