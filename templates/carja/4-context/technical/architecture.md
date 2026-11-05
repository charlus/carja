# Architecture

How is your system structured? Document the big picture so your AI partners understand where things live and how they connect.

---

## System Overview

(Describe your architecture at a high level. What are the main pieces and how do they talk to each other?)

---

## Folder Structure

```
your-project/
├── src/
│   ├── app/           # (describe)
│   ├── components/    # (describe)
│   ├── lib/           # (describe)
│   └── ...
├── public/
└── ...
```

---

## Data Flow

(How does data move through your system? User action → API → Database → Response?)

---

## Key Boundaries

| Boundary | What's on each side |
|----------|---------------------|
| Client/Server | (what runs where) |
| Auth boundary | (what's protected) |
| External APIs | (what you call) |

---

## Infrastructure

(Where does this run? How is it deployed? Any important infra notes?)
