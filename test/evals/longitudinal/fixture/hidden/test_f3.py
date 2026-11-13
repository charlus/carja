def book(rb, start, end, room="Alpha", who="ann", *extra):
    return rb("book", room, "--start", start, "--end", end, "--who", who, *extra)

def test_cancel_frees_the_slot(room):
    book(room, "2026-03-02T09:00", "2026-03-02T10:00")
    c = room.ok("cancel", "1")
    assert c["id"] == 1 and c["status"] == "cancelled"
    assert room.ok("bookings") == []
    assert book(room, "2026-03-02T09:00", "2026-03-02T10:00")[1]["id"] == 2

def test_confirmed_status(room):
    assert book(room, "2026-03-02T09:00", "2026-03-02T10:00")[1]["status"] == "confirmed"
    assert room.ok("bookings")[0]["status"] == "confirmed"

def test_cancel_errors(room):
    assert room("cancel", "1")[0] == 1
    book(room, "2026-03-02T09:00", "2026-03-02T10:00")
    room.ok("cancel", "1")
    assert room("cancel", "1")[0] == 1

def test_cancel_only_that_booking(room):
    book(room, "2026-03-02T09:00", "2026-03-02T10:00")
    book(room, "2026-03-02T10:00", "2026-03-02T11:00")
    room.ok("cancel", "1")
    assert [b["id"] for b in room.ok("bookings")] == [2]
