# LifeLink two-session concurrency demonstration

## Objective

Prove that two hospitals cannot reserve the same final compatible blood unit.
The demonstration uses two independent PostgreSQL connections, the
`reserve_emergency_blood` function, `SELECT ... FOR UPDATE`, database lock
catalogs, executable assertions, and audit history.

The runnable presenter script is
[`database/11_concurrency_demo.sql`](../database/11_concurrency_demo.sql).

## Scenario

| Item | Session A / winner | Session B / competitor |
| --- | --- | --- |
| Hospital | Green Valley Hospital | Harbourview Medical Centre |
| Request ID | `9` | `-910002` (temporary demo row) |
| Requested group | `AB-` | `AB-` |
| Priority | `CRITICAL` | `CRITICAL` |
| Required units | `1` | `1` |
| Reserving application actor | User `8`, blood-bank staff at bank `2` | Same authorized staff actor |
| Contended physical unit | Blood unit `12` | Blood unit `12` |

The two sessions intentionally use different emergency-request rows. This
prevents a request-row lock from being their first shared lock. Both sessions
can validate and lock their own request, after which they genuinely contend for
the one shared `blood_unit` row.

## Prerequisites

1. Use a fictional development/demo database, not production.
2. Run `database/01_schema.sql` through `database/10_test_queries.sql`.
3. Confirm unit `12` and request `9` are still in their seed states.
4. Open two independent pgAdmin Query Tool tabs connected to the same database,
   or two psql terminals:

   ```text
   psql -d <your_lifelink_database>
   ```

5. Open `database/11_concurrency_demo.sql` in both sessions. Execute only the
   marked block requested by each step.

Using two editor windows backed by the same connection is not sufficient. The
two sessions must show different `pg_backend_pid()` values.

## Execution sequence

| Step | Connection | SQL block | Required observation |
| ---: | --- | --- | --- |
| 1 | Session A | `SETUP` | Two separate `PENDING`, `CRITICAL`, `AB-` requests exist. |
| 2 | Session A | `SESSION A — START` | Request `9`, unit `12`, and the new reservation appear reserved inside A. Leave the transaction open. |
| 3 | Session B | `SESSION B — START` | The final function call remains running because A holds the unit row lock. |
| 4 | Session A | `LOCK OBSERVER` | B shows `wait_event_type = Lock`, `pg_blocking_pids` contains A's PID, and the block prints `LOCK PASS`. |
| 5 | Session A | `SESSION A — COMMIT` | A commits and releases its locks. |
| 6 | Session B | automatic result, then `SESSION B — ROLLBACK` | B resumes, receives SQLSTATE `P0002`, and rolls back. |
| 7 | Either | `PROOF` | Exactly one active reservation exists; request `9` won and request `-910002` has none. |
| 8 | Either | `CLEANUP` | Unit `12` returns to `AVAILABLE`; request `9` returns to `PENDING`; the temporary request is removed. |

## Expected Session B error

After Session A commits, Session B must resume with:

```text
ERROR: No reservable AB- blood unit is available to this user
SQLSTATE: P0002
```

This is the correct result. It means PostgreSQL waited for the conflicting
transaction, rechecked the candidate after the lock was released, and refused
to allocate the now-`RESERVED` unit.

If Session B returns a reservation row, the test has failed. Do not run cleanup
until the unexpected state is investigated.

## Required proof state

Before cleanup, the `PROOF` block enforces all of the following:

| Invariant | Expected value |
| --- | --- |
| Active reservations for unit `12` | Exactly `1` |
| Winning request | `9` |
| Unit `12` status | `RESERVED` |
| Request `9` status | `RESERVED` |
| Request `-910002` status | `PENDING` |
| Active reservations for request `-910002` | `0` |
| Winner unit audit | `AVAILABLE → RESERVED` exists |
| Winner request audit | `RESERVATION_PROGRESS → RESERVED` exists |

The block raises an exception if any invariant differs. A printed
`CONCURRENCY PASS` notice is the database's executable proof that no double
allocation occurred.

## What is locked

`reserve_emergency_blood` uses this order:

1. Lock its emergency request with `FOR UPDATE`.
2. Count existing allocations.
3. Find the earliest-expiring usable exact-group unit.
4. Lock the candidate with `FOR UPDATE OF bu`.
5. Insert the reservation.
6. Change the unit to `RESERVED`.
7. Change request progress.
8. Write audit events.

Because A and B use different request rows, step 4 is their shared contention
point. Session B waits on the transaction that changed unit `12`. At the
default `READ COMMITTED` isolation level, PostgreSQL re-evaluates the row after
the wait. The row no longer satisfies `status = 'AVAILABLE'`, so B receives
`P0002` rather than the unit.

## ACID explanation for the viva

| Property | LifeLink demonstration |
| --- | --- |
| Atomicity | Reservation, unit status, request status, and audit writes succeed or roll back together. |
| Consistency | Foreign keys, triggers, lifecycle checks, exact-group rules, and the partial unique index prevent invalid allocation states. |
| Isolation | Uncommitted changes remain hidden, and row locks serialize conflicting attempts for the same unit. |
| Durability | Once Session A commits, its reservation and audit rows survive transaction and connection completion. |

`COMMIT` makes Session A's successful work durable and releases its locks.
Session B's expected exception aborts its transaction; `ROLLBACK` clears that
failed transaction before the connection is reused.

## Why the naive approach is unsafe

A naive design separates these operations:

```sql
SELECT blood_unit_id
FROM lifelink.blood_unit
WHERE status = 'AVAILABLE';

-- Application waits or performs other work.

UPDATE lifelink.blood_unit
SET status = 'RESERVED'
WHERE blood_unit_id = ...;
```

Both sessions can read the same `AVAILABLE` row before either update occurs.
The application then has a race between reading and writing. LifeLink instead
puts selection, row locking, reservation creation, status changes, and audit
logging inside one database function and transaction.

## Why `SKIP LOCKED` is not used

`FOR UPDATE SKIP LOCKED` is helpful for worker queues, where another unlocked
job should be processed immediately. It is intentionally omitted here because
the academic objective is to make the blocking relationship visible. Plain
`FOR UPDATE` gives a clearer pgAdmin demonstration of waiting, blocker PID,
commit, recheck, and safe failure.

## Cleanup behavior

The cleanup follows legal lifecycle transitions:

1. Change the winner reservation from `ACTIVE` to `CANCELLED`.
2. Return unit `12` from `RESERVED` to `AVAILABLE`.
3. Return request `9` from `RESERVED` to `PENDING`.
4. Write a `CONCURRENCY_DEMO_RESET` audit event.
5. Delete temporary request `-910002`.

The cancelled reservation and audit events remain as legitimate historical
evidence. The operational scenario is nevertheless repeatable because no
`ACTIVE` hold remains.

## Screenshot checklist

Capture these for the report or presentation:

1. Setup output showing the two hospitals and two `PENDING` AB− requests.
2. Session A result showing unit `12` reserved while its transaction is open.
3. Session B visibly running/waiting.
4. Lock observer output showing:
   - different A and B backend PIDs;
   - B's `wait_event_type` as `Lock`;
   - A's PID inside B's blocker array;
   - the `LOCK PASS` notice.
5. Session A `COMMIT` output.
6. Session B's `P0002` error and subsequent `ROLLBACK`.
7. `CONCURRENCY PASS` and the one-winner/zero-loser result rows.
8. Winner audit timeline.
9. Final cleanup pass.

Never place real passwords or real patient information in screenshots.

## Verification record

The SQL artifact was checked against the complete `01–09` LifeLink build. Its
setup, winner transaction, expected loser `P0002`, invariant proof, audit proof,
cleanup, and repeat run all completed successfully in automated state testing.
The SQL also contains a live `pg_stat_activity`/`pg_locks` assertion that only
prints `LOCK PASS` when two real PostgreSQL backends exhibit the required
blocking relationship.

The final presentation evidence is therefore self-validating: do not accept a
demo run unless both `LOCK PASS` and `CONCURRENCY PASS` are printed.

## Troubleshooting

### Setup says the temporary request already exists

An earlier demo was interrupted. If one session still has an open transaction,
finish it with `ROLLBACK`. Inspect request `-910002`, unit `12`, and request `9`,
then run the cleanup block only when request `9` owns the active reservation.

### Session B does not wait

Check that:

- A and B show different `pg_backend_pid()` values;
- Session A has not committed or rolled back;
- Session A reserved unit `12`;
- Session B uses request `-910002`;
- both sessions connect to the same database;
- unit `12` was the only usable `AVAILABLE` AB− unit at setup time.

### Session B reaches the two-minute timeout

Session A was not committed in time. Run `ROLLBACK` in B, finish or roll back A,
restore the operational state, and repeat the sequence.

### Lock assertion aborts Session A

The observer was run before B reached its waiting state, or the sessions were
not independent. Roll back both sessions and repeat from setup. The strict
assertion intentionally refuses to label an unproved run as successful.

