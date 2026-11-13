import json, os, re, sys
from datetime import datetime, timedelta

T = "%Y-%m-%dT%H:%M"


class Err(Exception):
    def __init__(self, code, msg):
        self.code, self.msg = code, msg


def bad(msg):
    raise Err(1, msg)


def path():
    d = os.environ.get("ROOMBOOK_DATA")
    if not d:
        bad("ROOMBOOK_DATA is not set")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, "db.json")


def load():
    p = path()
    if os.path.exists(p):
        return json.load(open(p))
    return {"rooms": {}, "bookings": [], "next_id": 1, "next_series": 1}


def save(db):
    p = path()
    json.dump(db, open(p + ".tmp", "w"))
    os.replace(p + ".tmp", p)


def ptime(s):
    if not isinstance(s, str) or not re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d", s):
        bad(f"bad time {s}")
    try:
        return datetime.strptime(s, T)
    except ValueError:
        bad(f"bad time {s}")


def hm(s, allow24):
    if not re.fullmatch(r"\d\d:\d\d", s or ""):
        bad("bad hour")
    h, m = int(s[:2]), int(s[3:])
    if s == "24:00" and allow24:
        return 1440
    if h > 23 or m > 59:
        bad("bad hour")
    return h * 60 + m


def now():
    v = os.environ.get("ROOMBOOK_NOW")
    return ptime(v) if v else datetime.now().replace(second=0, microsecond=0)


def opts(args, flags, valued):
    pos, o = [], {}
    i = 0
    while i < len(args):
        a = args[i]
        if a in flags:
            o[a] = True
        elif a in valued:
            if i + 1 >= len(args):
                bad(f"{a} needs a value")
            o[a] = args[i + 1]
            i += 1
        elif a.startswith("--"):
            bad(f"unknown option {a}")
        else:
            pos.append(a)
        i += 1
    return pos, o


def room_view(r):
    return {"name": r["name"], "capacity": r["capacity"], "open": r["open"], "close": r["close"], "hourly": r["hourly"]}


def get_room(db, name):
    if name not in db["rooms"]:
        bad(f"unknown room {name}")
    return db["rooms"][name]


def pos_int(s, lo):
    if not re.fullmatch(r"\d+", s or ""):
        bad("not an integer")
    v = int(s)
    if v < lo:
        bad("too small")
    return v


def overlaps(db, room, s, e, ignore=None):
    for b in db["bookings"]:
        if b["room"] == room and b["status"] == "confirmed" and b["id"] != ignore and b["start"] < e and s < b["end"]:
            return True
    return False


def within_hours(r, s, e):
    o, c = hm(r["open"], False), hm(r["close"], True)
    sm = ptime(s).hour * 60 + ptime(s).minute
    em = ptime(e).hour * 60 + ptime(e).minute
    return sm >= o and em <= c


def price(r, s, e):
    mins = int((ptime(e) - ptime(s)).total_seconds() // 60)
    return r["hourly"] * mins // 60


def promote(db, room):
    r = db["rooms"][room]
    for b in sorted([b for b in db["bookings"] if b["room"] == room and b["status"] == "waiting"], key=lambda b: b["id"]):
        if within_hours(r, b["start"], b["end"]) and not overlaps(db, room, b["start"], b["end"]):
            b["status"] = "confirmed"
            b["price"] = price(r, b["start"], b["end"])


def cmd_room(db, args):
    if not args:
        bad("room needs a subcommand")
    sub, rest = args[0], args[1:]
    if sub == "add":
        pos, o = opts(rest, set(), {"--capacity"})
        if len(pos) != 1 or not (1 <= len(pos[0]) <= 40):
            bad("bad name")
        if pos[0] in db["rooms"]:
            bad("room exists")
        cap = pos_int(o.get("--capacity"), 1)
        db["rooms"][pos[0]] = {"name": pos[0], "capacity": cap, "open": "00:00", "close": "24:00", "hourly": 0}
        return room_view(db["rooms"][pos[0]]), True
    if sub == "list":
        return [room_view(db["rooms"][k]) for k in sorted(db["rooms"])], False
    if sub == "hours":
        pos, o = opts(rest, set(), {"--open", "--close"})
        if len(pos) != 1:
            bad("room hours ROOM")
        r = get_room(db, pos[0])
        op, cl = hm(o.get("--open"), False), hm(o.get("--close"), True)
        if op >= cl:
            bad("open must be before close")
        r["open"], r["close"] = o["--open"], o["--close"]
        return room_view(r), True
    if sub == "price":
        pos, o = opts(rest, set(), {"--hourly"})
        if len(pos) != 1:
            bad("room price ROOM")
        r = get_room(db, pos[0])
        r["hourly"] = pos_int(o.get("--hourly"), 0)
        return room_view(r), True
    if sub == "rename":
        pos, _ = opts(rest, set(), set())
        if len(pos) != 2:
            bad("room rename OLD NEW")
        old, new = pos
        r = get_room(db, old)
        if new in db["rooms"] or not (1 <= len(new) <= 40):
            bad("bad new name")
        del db["rooms"][old]
        r["name"] = new
        db["rooms"][new] = r
        for b in db["bookings"]:
            if b["room"] == old:
                b["room"] = new
        return room_view(r), True
    bad(f"unknown room subcommand {sub}")


def cmd_book(db, args):
    pos, o = opts(args, {"--wait"}, {"--start", "--end", "--who", "--people", "--repeat", "--count"})
    if len(pos) != 1:
        bad("book ROOM")
    r = get_room(db, pos[0])
    s, e = ptime(o.get("--start")), ptime(o.get("--end"))
    if not o.get("--who"):
        bad("--who is required")
    if e <= s or e.date() != s.date():
        bad("end must be after start on the same day")
    people = pos_int(o["--people"], 1) if "--people" in o else 1
    if people > r["capacity"]:
        bad("too many people")
    rep, count = o.get("--repeat"), o.get("--count")
    n = 1
    if rep is not None or count is not None:
        if rep != "weekly" or count is None:
            bad("--repeat weekly --count N")
        n = pos_int(count, 2)
        if n > 52:
            bad("count too large")
        if o.get("--wait"):
            bad("--wait is for single bookings")
    occ = [((s + timedelta(weeks=k)).strftime(T), (e + timedelta(weeks=k)).strftime(T)) for k in range(n)]
    for a, b in occ:
        if not within_hours(r, a, b):
            bad("outside opening hours")
    conflict = any(overlaps(db, r["name"], a, b) for a, b in occ)
    if conflict and not o.get("--wait"):
        raise Err(2, "conflict")
    series = None
    if n > 1:
        series = db["next_series"]
        db["next_series"] += 1
    out = []
    for a, b in occ:
        bk = {"id": db["next_id"], "room": r["name"], "start": a, "end": b, "who": o["--who"], "people": people,
              "series": series, "status": "waiting" if conflict else "confirmed",
              "price": None if conflict else price(r, a, b), "cancelled_at": None}
        db["next_id"] += 1
        db["bookings"].append(bk)
        out.append(bk)
    return (out if n > 1 else out[0]), True


def view(b):
    return {k: v for k, v in b.items() if k != "cancelled_at"}


def cmd_cancel(db, args):
    pos, o = opts(args, set(), {"--series"})
    if "--series" in o:
        sid = pos_int(o["--series"], 1)
        hit = [b for b in db["bookings"] if b["series"] == sid and b["status"] != "cancelled"]
        if not hit:
            bad("nothing to cancel")
    else:
        if len(pos) != 1:
            bad("cancel ID")
        bid = pos_int(pos[0], 1)
        hit = [b for b in db["bookings"] if b["id"] == bid and b["status"] != "cancelled"]
        if not hit:
            bad("unknown or cancelled")
    t = now().strftime(T)
    rooms = set()
    for b in hit:
        b["status"] = "cancelled"
        b["cancelled_at"] = t
        rooms.add(b["room"])
    for rm in rooms:
        promote(db, rm)
    res = [view(b) for b in hit]
    return (res if "--series" in o else res[0]), True


def cmd_bookings(db, args, status):
    _, o = opts(args, set(), {"--room", "--day"})
    bs = [b for b in db["bookings"] if b["status"] == status]
    if "--room" in o:
        bs = [b for b in bs if b["room"] == o["--room"]]
    if "--day" in o:
        bs = [b for b in bs if b["start"][:10] == o["--day"]]
    key = (lambda b: (b["start"], b["id"])) if status == "confirmed" else (lambda b: b["id"])
    return [view(b) for b in sorted(bs, key=key)], False


def cmd_invoice(db, args):
    _, o = opts(args, set(), {"--who", "--month"})
    who, month = o.get("--who"), o.get("--month")
    if not who or not re.fullmatch(r"\d{4}-\d\d", month or ""):
        bad("invoice --who NAME --month YYYY-MM")
    lines = []
    for b in db["bookings"]:
        if b["who"] != who or b["start"][:7] != month:
            continue
        if b["status"] == "confirmed":
            ch = b["price"]
        elif b["status"] == "cancelled" and b["price"] is not None and b["cancelled_at"] and ptime(b["cancelled_at"]) > ptime(b["start"]) - timedelta(hours=24):
            ch = b["price"] // 2
        else:
            continue
        lines.append({"id": b["id"], "room": b["room"], "start": b["start"], "charge": ch})
    lines.sort(key=lambda l: (l["start"], l["id"]))
    return {"who": who, "month": month, "lines": lines, "total": sum(l["charge"] for l in lines)}, False


def cmd_report(db, args):
    _, o = opts(args, set(), {"--day"})
    day = o.get("--day")
    if not re.fullmatch(r"\d{4}-\d\d-\d\d", day or ""):
        bad("report --day DATE")
    out = []
    for name in sorted(db["rooms"]):
        r = db["rooms"][name]
        booked = sum(int((ptime(b["end"]) - ptime(b["start"])).total_seconds() // 60)
                     for b in db["bookings"] if b["room"] == name and b["status"] == "confirmed" and b["start"][:10] == day)
        om = hm(r["close"], True) - hm(r["open"], False)
        out.append({"room": name, "booked_minutes": booked, "open_minutes": om, "utilisation": round(booked / om + 1e-9, 2)})
    return out, False


def main(argv):
    if not argv:
        bad("no command")
    db = load()
    c, rest = argv[0], argv[1:]
    if c == "room":
        out, w = cmd_room(db, rest)
    elif c == "book":
        out, w = cmd_book(db, rest)
    elif c == "cancel":
        out, w = cmd_cancel(db, rest)
    elif c == "bookings":
        out, w = cmd_bookings(db, rest, "confirmed")
    elif c == "waitlist":
        out, w = cmd_bookings(db, rest, "waiting")
    elif c == "invoice":
        out, w = cmd_invoice(db, rest)
    elif c == "report":
        out, w = cmd_report(db, rest)
    else:
        bad(f"unknown command {c}")
    if w:
        save(db)
    if isinstance(out, dict) and "cancelled_at" in out:
        out = view(out)
    if isinstance(out, list):
        out = [view(x) if isinstance(x, dict) and "cancelled_at" in x else x for x in out]
    print(json.dumps(out))


try:
    main(sys.argv[1:])
except Err as e:
    print(e.msg, file=sys.stderr)
    sys.exit(e.code)
