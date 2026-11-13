def series(rb, start, end, n, room="Alpha", who="ann", *extra):
    return rb("book", room, "--start", start, "--end", end, "--who", who, "--repeat", "weekly", "--count", str(n), *extra)

def test_creates_weekly_occurrences(room):
    code, bs = series(room, "2026-03-02T09:00", "2026-03-02T10:00", 3)
    assert code == 0
    assert [b["start"] for b in bs] == ["2026-03-02T09:00", "2026-03-09T09:00", "2026-03-16T09:00"]
    assert [b["end"] for b in bs] == ["2026-03-02T10:00", "2026-03-09T10:00", "2026-03-16T10:00"]
    assert {b["series"] for b in bs} == {1}
    assert len({b["id"] for b in bs}) == 3

def test_crosses_month_end(room):
    bs = series(room, "2026-03-30T09:00", "2026-03-30T10:00", 2)[1]
    assert bs[1]["start"] == "2026-04-06T09:00"

def test_single_booking_has_no_series(room):
    assert room.ok("book", "Alpha", "--start", "2026-03-02T09:00", "--end", "2026-03-02T10:00", "--who", "ann")["series"] is None

def test_series_ids_are_separate(room):
    room.ok("book", "Alpha", "--start", "2026-03-02T09:00", "--end", "2026-03-02T10:00", "--who", "ann")
    assert series(room, "2026-03-03T09:00", "2026-03-03T10:00", 2)[1][0]["series"] == 1
    assert series(room, "2026-03-04T09:00", "2026-03-04T10:00", 2)[1][0]["series"] == 2

def test_all_or_nothing_on_conflict(room):
    room.ok("book", "Alpha", "--start", "2026-03-16T09:30", "--end", "2026-03-16T10:30", "--who", "bob")
    assert series(room, "2026-03-02T09:00", "2026-03-02T10:00", 3)[0] == 2
    assert len(room.ok("bookings")) == 1

def test_count_bounds_and_pairing(room):
    assert series(room, "2026-03-02T09:00", "2026-03-02T10:00", 1)[0] == 1
    assert series(room, "2026-03-02T09:00", "2026-03-02T10:00", 53)[0] == 1
    assert room("book", "Alpha", "--start", "2026-03-02T09:00", "--end", "2026-03-02T10:00", "--who", "a", "--repeat", "weekly")[0] == 1
    assert room("book", "Alpha", "--start", "2026-03-02T09:00", "--end", "2026-03-02T10:00", "--who", "a", "--count", "2")[0] == 1
    assert room("book", "Alpha", "--start", "2026-03-02T09:00", "--end", "2026-03-02T10:00", "--who", "a", "--repeat", "daily", "--count", "2")[0] == 1
    assert room.ok("bookings") == []

def test_cancel_series(room):
    series(room, "2026-03-02T09:00", "2026-03-02T10:00", 3)
    room.ok("cancel", "2")
    out = room.ok("cancel", "--series", "1")
    assert sorted(b["id"] for b in out) == [1, 3]
    assert room.ok("bookings") == []
    assert room("cancel", "--series", "1")[0] == 1
    assert room("cancel", "--series", "9")[0] == 1

def test_cancel_one_occurrence(room):
    series(room, "2026-03-02T09:00", "2026-03-02T10:00", 3)
    room.ok("cancel", "2")
    assert [b["id"] for b in room.ok("bookings")] == [1, 3]
