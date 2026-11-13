def book(rb, start, end, room="Alpha", who="ann", *extra):
    return rb("book", room, "--start", start, "--end", end, "--who", who, *extra)

def test_conflict_goes_to_waiting_list(room):
    book(room, "2026-03-02T09:00", "2026-03-02T10:00")
    code, w = book(room, "2026-03-02T09:30", "2026-03-02T10:30", "Alpha", "bob", "--wait")
    assert code == 0 and w["status"] == "waiting" and w["id"] == 2
    assert [b["id"] for b in room.ok("bookings")] == [1]
    assert [x["id"] for x in room.ok("waitlist")] == [2]
    assert book(room, "2026-03-02T11:00", "2026-03-02T12:00")[1]["id"] == 3

def test_wait_without_conflict_books(room):
    assert book(room, "2026-03-02T09:00", "2026-03-02T10:00", "Alpha", "ann", "--wait")[1]["status"] == "confirmed"

def test_wait_invalid_still_fails(room):
    book(room, "2026-03-02T09:00", "2026-03-02T10:00")
    assert book(room, "2026-03-02T09:00", "2026-03-02T10:00", "Alpha", "bob", "--wait", "--people", "9")[0] == 1
    assert book(room, "2026-03-02T09:00", "2026-03-02T10:00", "Alpha", "bob", "--wait", "--repeat", "weekly", "--count", "2")[0] == 1
    assert room.ok("waitlist") == []

def test_cancel_promotes_in_order(room):
    book(room, "2026-03-02T09:00", "2026-03-02T11:00")
    book(room, "2026-03-02T09:00", "2026-03-02T10:00", "Alpha", "bob", "--wait")
    book(room, "2026-03-02T09:30", "2026-03-02T10:30", "Alpha", "cid", "--wait")
    book(room, "2026-03-02T10:00", "2026-03-02T11:00", "Alpha", "dee", "--wait")
    room.ok("cancel", "1")
    assert [b["id"] for b in room.ok("bookings")] == [2, 4]
    assert [x["id"] for x in room.ok("waitlist")] == [3]
    assert [b["status"] for b in room.ok("bookings")] == ["confirmed", "confirmed"]

def test_promotion_respects_current_hours(room):
    book(room, "2026-03-02T07:00", "2026-03-02T09:00")
    book(room, "2026-03-02T07:00", "2026-03-02T08:00", "Alpha", "bob", "--wait")
    book(room, "2026-03-02T08:00", "2026-03-02T09:00", "Alpha", "cid", "--wait")
    room.ok("room", "hours", "Alpha", "--open", "08:00", "--close", "18:00")
    room.ok("cancel", "1")
    assert [b["id"] for b in room.ok("bookings")] == [3]
    assert [x["id"] for x in room.ok("waitlist")] == [2]

def test_cancel_waiting_request(room):
    book(room, "2026-03-02T09:00", "2026-03-02T10:00")
    book(room, "2026-03-02T09:00", "2026-03-02T10:00", "Alpha", "bob", "--wait")
    assert room.ok("cancel", "2")["status"] == "cancelled"
    assert room.ok("waitlist") == []
    room.ok("cancel", "1")
    assert room.ok("bookings") == []

def test_waitlist_room_filter(room):
    room.ok("room", "add", "Beta", "--capacity", "2")
    book(room, "2026-03-02T09:00", "2026-03-02T10:00")
    book(room, "2026-03-02T09:00", "2026-03-02T10:00", "Beta")
    book(room, "2026-03-02T09:00", "2026-03-02T10:00", "Beta", "x", "--wait")
    book(room, "2026-03-02T09:00", "2026-03-02T10:00", "Alpha", "y", "--wait")
    assert [x["id"] for x in room.ok("waitlist")] == [3, 4]
    assert [x["id"] for x in room.ok("waitlist", "--room", "Alpha")] == [4]

def test_series_cancel_promotes(room):
    book(room, "2026-03-02T09:00", "2026-03-02T10:00", "Alpha", "ann", "--repeat", "weekly", "--count", "2")
    book(room, "2026-03-09T09:00", "2026-03-09T10:00", "Alpha", "bob", "--wait")
    room.ok("cancel", "--series", "1")
    assert [b["id"] for b in room.ok("bookings")] == [3]
