import json, os, urllib.request, urllib.parse
from datetime import datetime
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Europe/Moscow")   # поменяй на свой часовой пояс
today = datetime.now(TZ).date()
items = json.load(open("data.json", encoding="utf-8"))

lines = []
for i in sorted(items, key=lambda x: x["due"]):
    d = (datetime.strptime(i["due"], "%Y-%m-%d").date() - today).days
    if 0 <= d <= 2:
        when = ["сегодня", "завтра", "послезавтра"][d]
        lines.append(f"❗ {i['subject']}: {i['task']} — {when}")

if lines:
    text = "Горящие задания:\n\n" + "\n".join(lines)
    data = urllib.parse.urlencode({"chat_id": os.environ["CHAT_ID"], "text": text}).encode()
    urllib.request.urlopen(
        f"https://api.telegram.org/bot{os.environ['BOT_TOKEN']}/sendMessage", data
    )
