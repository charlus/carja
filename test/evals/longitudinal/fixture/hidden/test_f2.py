def book(rb, start, end, room="Alpha", who="ann", *extra):
    return rb("book", room, "--start", start, "--end", end, "--who", who, *extra)

def test_booking_fields_and_ids(room):
    code, b = book(room, "2026-03-02T09:00", "2026-03-02T10:00")
    assert code == 0
    assert (b["id"], b["room"], b["start"], b["end"], b["who"], b["people"]) == (1, "Alpha", "2026-03-02T09:00", "2026-03-02T10:00", "ann", 1)
    assert book(room, "2026-03-02T10:00", "2026-03-02T11:00", "Alpha", "bob", "--people", "3")[1]["id"] == 2

def test_overlap_is_a_conflict(room):
    book(room, "2026-03-02T09:00", "2026-03-02T10:00")
    assert book(room, "2026-03-02T09:30", "2026-03-02T10:30")[0] == 2
    assert book(room, "2026-03-02T08:00", "2026-03-02T11:00")[0] == 2

def test_half_open_intervals(room):
    book(room, "2026-03-02T09:00", "2026-03-02T10:00")
    assert book(room, "2026-03-02T10:00", "2026-03-02T11:00")[0] == 0
    assert book(room, "2026-03-02T08:00", "2026-03-02T09:00")[0] == 0

def test_other_room_does_not_conflict(room):
    room.ok("room", "add", "Beta", "--capacity", "2")
    book(room, "2026-03-02T09:00", "2026-03-02T10:00")
    assert book(room, "2026-03-02T09:00", "2026-03-02T10:00", "Beta")[0] == 0

def test_invalid_requests(room):
    assert book(room, "2026-03-02T09:00", "2026-03-02T10:00", "Nope")[0] == 1
    assert book(room, "2026-03-02T10:00", "2026-03-02T09:00")[0] == 1
    assert book(room, "2026-03-02T10:00", "2026-03-02T10:00")[0] == 1
    assert book(room, "2026-03-02T22:00", "2026-03-03T01:00")[0] == 1
    assert book(room, "2026-03-02 09:00", "2026-03-02T10:00")[0] == 1
    assert book(room, "2026-03-02T09:00", "2026-03-02T10:00", "Alpha", "ann", "--people", "7")[0] == 1
    assert book(room, "2026-03-02T09:00", "2026-03-02T10:00", "Alpha", "ann", "--people", "0")[0] == 1

def test_invalid_beats_conflict(room):
    book(room, "2026-03-02T09:00", "2026-03-02T10:00")
    assert book(room, "2026-03-02T09:00", "2026-03-02T10:00", "Alpha", "ann", "--people", "9")[0] == 1

def test_failed_requests_use_no_id(room):
    book(room, "2026-03-02T09:00", "2026-03-02T10:00")
    book(room, "2026-03-02T09:00", "2026-03-02T10:00")
    book(room, "2026-03-02T10:00", "2026-03-02T09:00")
    assert book(room, "2026-03-02T11:00", "2026-03-02T12:00")[1]["id"] == 2

def test_list_sorted_and_filtered(room):
    room.ok("room", "add", "Beta", "--capacity", "2")
    book(room, "2026-03-03T09:00", "2026-03-03T10:00")
    book(room, "2026-03-02T11:00", "2026-03-02T12:00", "Beta")
    book(room, "2026-03-02T09:00", "2026-03-02T10:00")
    book(room, "2026-03-02T09:00", "2026-03-02T10:00", "Beta")
    assert [b["id"] for b in room.ok("bookings")] == [3, 4, 2, 1]
    assert [b["id"] for b in room.ok("bookings", "--room", "Beta")] == [4, 2]
    assert [b["id"] for b in room.ok("bookings", "--day", "2026-03-02")] == [3, 4, 2]
    assert [b["id"] for b in room.ok("bookings", "--room", "Alpha", "--day", "2026-03-02")] == [3]
