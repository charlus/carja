def book(rb, start, end, room="Alpha", who="ann", *extra, now=None):
    return rb("book", room, "--start", start, "--end", end, "--who", who, *extra, now=now)

def test_default_and_set_price(room):
    assert room.ok("room", "list")[0]["hourly"] == 0
    assert room.ok("room", "price", "Alpha", "--hourly", "1200")["hourly"] == 1200
    assert room("room", "price", "Alpha", "--hourly", "-1")[0] == 1
    assert room("room", "price", "Nope", "--hourly", "5")[0] == 1

def test_price_rounds_down(room):
    room.ok("room", "price", "Alpha", "--hourly", "1000")
    assert book(room, "2026-03-02T09:00", "2026-03-02T10:30")[1]["price"] == 1500
    assert book(room, "2026-03-02T11:00", "2026-03-02T11:07")[1]["price"] == 116

def test_price_is_fixed_at_confirmation(room):
    room.ok("room", "price", "Alpha", "--hourly", "600")
    book(room, "2026-03-02T09:00", "2026-03-02T10:00")
    room.ok("room", "price", "Alpha", "--hourly", "900")
    book(room, "2026-03-02T10:00", "2026-03-02T11:00")
    assert [b["price"] for b in room.ok("bookings")] == [600, 900]

def test_waiting_price_null_then_set_at_promotion(room):
    room.ok("room", "price", "Alpha", "--hourly", "600")
    book(room, "2026-03-02T09:00", "2026-03-02T10:00")
    w = book(room, "2026-03-02T09:00", "2026-03-02T10:00", "Alpha", "bob", "--wait")[1]
    assert w["price"] is None
    room.ok("room", "price", "Alpha", "--hourly", "1200")
    room.ok("cancel", "1")
    assert room.ok("bookings")[0]["price"] == 1200

def test_invoice(room):
    room.ok("room", "add", "Beta", "--capacity", "4")
    room.ok("room", "price", "Alpha", "--hourly", "1000")
    room.ok("room", "price", "Beta", "--hourly", "2001")
    book(room, "2026-03-10T09:00", "2026-03-10T10:00")                      # 1: 1000
    book(room, "2026-03-05T09:00", "2026-03-05T10:00", "Beta")              # 2: 2001
    book(room, "2026-03-20T09:00", "2026-03-20T10:00")                      # 3: late cancel -> 500
    book(room, "2026-03-25T09:00", "2026-03-25T10:00")                      # 4: early cancel -> not listed
    book(room, "2026-04-01T09:00", "2026-04-01T10:00")                      # 5: other month
    book(room, "2026-03-11T09:00", "2026-03-11T10:00", "Alpha", "bob")      # 6: other person
    book(room, "2026-03-05T09:00", "2026-03-05T10:00", "Beta", "ann", "--wait")  # 7: waiting
    room.ok("cancel", "3", now="2026-03-19T10:00")
    room.ok("cancel", "4", now="2026-03-24T09:00")
    inv = room.ok("invoice", "--who", "ann", "--month", "2026-03")
    assert inv["who"] == "ann" and inv["month"] == "2026-03"
    assert [(l["id"], l["room"], l["charge"]) for l in inv["lines"]] == [(2, "Beta", 2001), (1, "Alpha", 1000), (3, "Alpha", 500)]
    assert inv["lines"][0]["start"] == "2026-03-05T09:00"
    assert inv["total"] == 3501

def test_half_price_rounds_down(room):
    room.ok("room", "price", "Alpha", "--hourly", "1001")
    book(room, "2026-03-10T09:00", "2026-03-10T10:00")
    room.ok("cancel", "1", now="2026-03-10T08:00")
    assert room.ok("invoice", "--who", "ann", "--month", "2026-03")["total"] == 500

def test_empty_invoice(room):
    inv = room.ok("invoice", "--who", "zed", "--month", "2026-03")
    assert inv["lines"] == [] and inv["total"] == 0
