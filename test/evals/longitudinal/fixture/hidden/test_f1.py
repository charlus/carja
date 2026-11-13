def test_add_prints_the_room(rb):
    r = rb.ok("room", "add", "Alpha", "--capacity", "6")
    assert r["name"] == "Alpha" and r["capacity"] == 6

def test_list_is_sorted_by_name_and_persists(rb):
    rb.ok("room", "add", "Gamma", "--capacity", "2")
    rb.ok("room", "add", "Alpha", "--capacity", "4")
    rb.ok("room", "add", "Beta", "--capacity", "8")
    rooms = rb.ok("room", "list")
    assert [r["name"] for r in rooms] == ["Alpha", "Beta", "Gamma"]
    assert [r["capacity"] for r in rooms] == [4, 8, 2]

def test_empty_list(rb):
    assert rb.ok("room", "list") == []

def test_duplicate_name_is_invalid(rb):
    rb.ok("room", "add", "Alpha", "--capacity", "6")
    assert rb("room", "add", "Alpha", "--capacity", "3")[0] == 1
    assert len(rb.ok("room", "list")) == 1

def test_names_are_case_sensitive(rb):
    rb.ok("room", "add", "Alpha", "--capacity", "6")
    rb.ok("room", "add", "alpha", "--capacity", "3")
    assert len(rb.ok("room", "list")) == 2

def test_bad_capacity_is_invalid(rb):
    assert rb("room", "add", "A", "--capacity", "0")[0] == 1
    assert rb("room", "add", "B", "--capacity", "x")[0] == 1
    assert rb("room", "add", "C")[0] == 1
    assert rb.ok("room", "list") == []

def test_name_length(rb):
    assert rb("room", "add", "x" * 41, "--capacity", "2")[0] == 1
    rb.ok("room", "add", "x" * 40, "--capacity", "2")
