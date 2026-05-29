# Outreach Hub — Project Overview

*A plain-English guide to what Outreach Hub is and what it does. Written for a
non-technical audience — no prior knowledge required.*

---

## What it is

Outreach Hub is a **sales prospecting tool** for DisplayNote's outbound sales
team. Think of it as **mission control for the people we want to reach out to**:
it keeps track of every prospect, every call, and every email, so a salesperson
always knows who to contact next and what to say.

Today this lives as a tool that one person runs on their own computer. The
project is rebuilding it as a **proper shared web app** that the whole team logs
into with their normal Microsoft work account — so everyone's prospects, emails,
and call history live in one secure place instead of on a single laptop.

---

## What it lets a salesperson do

### 📇 Organise who to contact
- Group prospects into **campaigns** (e.g. by product push or region), each colour-coded.
- Import contact lists, move people between campaigns, and pull in contacts from sources like **Apollo** and **LinkedIn**.

### 📞 Make calls
- **Click-to-call** any contact straight from the screen.
- Work through a **call queue** with an auto-dial mode.
- Log the outcome of each call — *connected*, *left a message*, *no answer*, *had a conversation*, *callback needed*.
- The outcome **automatically updates** where that person sits in the pipeline.

### ✉️ Send emails on autopilot
- Build **multi-step email sequences** ("send this, wait 3 working days, then send that") using reusable templates and snippets.
- Enrol contacts into a sequence and the system **queues the right email on the right day**.
- Emails send from the salesperson's **own Microsoft mailbox**, and replies are tracked automatically.

### ⏰ Stay on top of follow-ups
- A clear **"due today"** view: emails to send, follow-ups due, and overdue items.
- **Daily caps** so nobody over-contacts a prospect.
- A full **activity timeline** per contact — every call, email, and note in one place.

### 📊 See how it's going
- A **pipeline view** showing each prospect's status: *not contacted → contacted → in conversation → meeting booked → not interested*.
- **Reporting**: conversion funnel, meetings booked, calls and emails this week, and busiest days.

---

## In one sentence

> **"It's the team's shared system for chasing sales leads — it tells each
> salesperson who to call and email next, dials and sends for them, and tracks
> every interaction so we can see which outreach is actually turning into
> meetings."**

---

## Where the project is today

The features above describe the **full vision**, drawn from the original tool and
the project plan. The build is currently at **Phase 0** — the foundations:
secure login with Microsoft, hosting, and the underlying plumbing. Most of the
features above are **planned and scoped, but not built yet**.

Roughly how the work is staged:

| Stage | What it delivers |
|-------|------------------|
| **Phase 0 (now)** | Foundations: Microsoft sign-in, hosting, data plumbing, automated quality checks |
| **Next** | Campaigns & contacts, the pipeline view, logging calls and notes |
| **Then** | Click-to-call dialler, email sequences sending from your own mailbox |
| **Later** | Full reporting, power dialling, integrations (e.g. Zoho), and AI-assisted calling |

---

*This document is a non-technical summary. For the technical scope and build
plan, see `docs/OUTREACH_HUB_EXECUTION_PLAN.md`.*
