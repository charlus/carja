def book(rb, start, end, room="Alpha", who="ann", *extra):
    return rb("book", room, "--start", start, "--end", end, "--who", who, *extra)

def test_default_hours(room):
    r = room.ok("room", "list")[0]
    assert (r["open"], r["close"]) == ("00:00", "24:00")

def test_set_hours(room):
    r = room.ok("room", "hours", "Alpha", "--open", "08:00", "--close", "18:00")
    assert (r["open"], r["close"]) == ("08:00", "18:00")
    assert room.ok("room", "list")[0]["open"] == "08:00"

def test_bookings_must_fit(room):
    room.ok("room", "hours", "Alpha", "--open", "08:00", "--close", "18:00")
    assert book(room, "2026-03-02T07:30", "2026-03-02T09:00")[0] == 1
    assert book(room, "2026-03-02T17:00", "2026-03-02T18:30")[0] == 1
    assert book(room, "2026-03-02T08:00", "2026-03-02T09:00")[0] == 0
    assert book(room, "2026-03-02T17:00", "2026-03-02T18:00")[0] == 0

def test_invalid_hours(room):
    assert room("room", "hours", "Alpha", "--open", "18:00", "--close", "08:00")[0] == 1
    assert room("room", "hours", "Alpha", "--open", "24:00", "--close", "24:00")[0] == 1
    assert room("room", "hours", "Alpha", "--open", "8am", "--close", "18:00")[0] == 1
    assert room("room", "hours", "Nope", "--open", "08:00", "--close", "18:00")[0] == 1
    assert room.ok("room", "hours", "Alpha", "--open", "06:00", "--close", "24:00")["close"] == "24:00"

def test_series_checks_hours(room):
    room.ok("room", "hours", "Alpha", "--open", "08:00", "--close", "18:00")
    assert book(room, "2026-03-02T17:30", "2026-03-02T18:30", "Alpha", "ann", "--repeat", "weekly", "--count", "2")[0] == 1
    assert room.ok("bookings") == []

def test_existing_bookings_stay(room):
    book(room, "2026-03-02T07:00", "2026-03-02T08:00")
    room.ok("room", "hours", "Alpha", "--open", "09:00", "--close", "17:00")
    assert [b["id"] for b in room.ok("bookings")] == [1]
