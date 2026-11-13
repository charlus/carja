def book(rb, start, end, room="Alpha", who="ann", *extra, now=None):
    return rb("book", room, "--start", start, "--end", end, "--who", who, *extra, now=now)

def test_rename(room):
    room.ok("room", "add", "Beta", "--capacity", "2")
    r = room.ok("room", "rename", "Alpha", "Zeta")
    assert r["name"] == "Zeta" and r["capacity"] == 6
    assert [x["name"] for x in room.ok("room", "list")] == ["Beta", "Zeta"]
    assert room("room", "rename", "Zeta", "Beta")[0] == 1
    assert room("room", "rename", "Nope", "New")[0] == 1

def test_rename_carries_everything(room):
    room.ok("room", "price", "Alpha", "--hourly", "600")
    book(room, "2026-03-02T09:00", "2026-03-02T10:00", "Alpha", "ann", "--repeat", "weekly", "--count", "2")
    book(room, "2026-03-02T09:00", "2026-03-02T10:00", "Alpha", "bob", "--wait")
    room.ok("room", "rename", "Alpha", "Zeta")
    assert {b["room"] for b in room.ok("bookings")} == {"Zeta"}
    assert len(room.ok("bookings", "--room", "Zeta")) == 2
    assert [x["room"] for x in room.ok("waitlist", "--room", "Zeta")] == ["Zeta"]
    assert {l["room"] for l in room.ok("invoice", "--who", "ann", "--month", "2026-03")["lines"]} == {"Zeta"}
    assert book(room, "2026-03-02T09:00", "2026-03-02T10:00", "Zeta")[0] == 2
    assert book(room, "2026-03-03T09:00", "2026-03-03T10:00", "Alpha")[0] == 1
    room.ok("cancel", "--series", "1")
    assert [b["who"] for b in room.ok("bookings", "--room", "Zeta")] == ["bob"]

def test_report(room):
    room.ok("room", "add", "Beta", "--capacity", "2")
    room.ok("room", "hours", "Alpha", "--open", "08:00", "--close", "17:00")
    book(room, "2026-03-02T09:00", "2026-03-02T10:00")
    book(room, "2026-03-02T13:00", "2026-03-02T14:40")
    book(room, "2026-03-02T15:00", "2026-03-02T16:00")
    room.ok("cancel", "3")
    book(room, "2026-03-03T09:00", "2026-03-03T10:00")
    book(room, "2026-03-02T09:00", "2026-03-02T10:00", "Alpha", "bob", "--wait")
    rep = room.ok("report", "--day", "2026-03-02")
    assert [x["room"] for x in rep] == ["Alpha", "Beta"]
    a, b = rep
    assert (a["booked_minutes"], a["open_minutes"], a["utilisation"]) == (160, 540, 0.3)
    assert (b["booked_minutes"], b["open_minutes"], b["utilisation"]) == (0, 1440, 0)

def test_report_rounding(room):
    room.ok("room", "hours", "Alpha", "--open", "09:00", "--close", "12:00")
    book(room, "2026-03-02T09:00", "2026-03-02T09:20")
    assert room.ok("report", "--day", "2026-03-02")[0]["utilisation"] == 0.11
