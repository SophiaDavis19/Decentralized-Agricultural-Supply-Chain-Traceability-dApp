;; contracts/supply-chain-trace.clar
(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-BATCH u101)
(define-constant ERR-BATCH-NOT-FOUND u102)
(define-constant ERR-STEP-EXISTS u103)
(define-constant ERR-INVALID-ACTOR u104)
(define-constant ERR-INVALID-ACTION u105)
(define-constant ERR-INVALID-TIMESTAMP u106)
(define-constant ERR-STEP-LIMIT u107)
(define-constant ERR-ROLE-NOT-REGISTERED u108)
(define-constant ERR-CONTRACT-NOT-INITIALIZED u109)
(define-constant ERR-IPFS-HASH u110)
(define-constant ERR-LOCATION u111)
(define-constant ERR-QUANTITY u112)
(define-constant ERR-STATUS u113)
(define-constant ERR-TRACE-LOCKED u114)
(define-constant ERR-INVALID-STATUS-TRANSITION u115)

(define-data-var next-trace-id uint u1)
(define-data-var registry-contract (optional principal) none)
(define-data-var max-steps-per-batch uint u50)

(define-map batch-traces
  uint
  {
    batch-id: uint,
    locked: bool,
    status: (string-ascii 20),
    created-at: uint,
    updated-at: uint,
    creator: principal
  }
)

(define-map trace-steps
  { trace-id: uint, step-index: uint }
  {
    actor: principal,
    role: (string-ascii 20),
    action: (string-ascii 50),
    location: (string-utf8 100),
    quantity: uint,
    ipfs-hash: (string-ascii 46),
    timestamp: uint,
    notes: (string-utf8 256)
  }
)

(define-map trace-index uint uint)

(define-read-only (get-trace (trace-id uint))
  (map-get? batch-traces trace-id)
)

(define-read-only (get-step (trace-id uint) (step-index uint))
  (map-get? trace-steps { trace-id: trace-id, step-index: step-index })
)

(define-read-only (get-trace-id-by-batch (batch-id uint))
  (map-get? trace-index batch-id)
)

(define-read-only (get-total-steps (trace-id uint))
  (let ((steps (default-to u0 (map-get? trace-steps { trace-id: trace-id, step-index: u0 }))))
    (if (is-some steps) (len (unwrap-panic (as-max-len? (list) u50))) u0))
)

(define-private (validate-role (user principal))
  (let ((registry (var-get registry-contract)))
    (if (is-some registry)
      (contract-call? (unwrap! registry ERR-CONTRACT-NOT-INITIALIZED) get-user user)
      (err ERR-CONTRACT-NOT-INITIALIZED)))
)

(define-private (validate-action (action (string-ascii 50)))
  (if (or
        (is-eq action "plant")
        (is-eq action "harvest")
        (is-eq action "process")
        (is-eq action "package")
        (is-eq action "ship")
        (is-eq action "receive")
        (is-eq action "store")
        (is-eq action "retail"))
    (ok true)
    (err ERR-INVALID-ACTION))
)

(define-private (validate-location (loc (string-utf8 100)))
  (if (and (> (len loc) u0) (<= (len loc) u100))
    (ok true)
    (err ERR-LOCATION))
)

(define-private (validate-quantity (qty uint))
  (if (> qty u0) (ok true) (err ERR-QUANTITY))
)

(define-private (validate-ipfs-hash (hash (string-ascii 46)))
  (if (and (is-eq (len hash) u46) (is-eq (element-at hash u0) "Q"))
    (ok true)
    (err ERR-IPFS-HASH))
)

(define-private (validate-status (status (string-ascii 20)))
  (if (or
        (is-eq status "active")
        (is-eq status "recalled")
        (is-eq status "quarantined")
        (is-eq status "destroyed"))
    (ok true)
    (err ERR-STATUS))
)

(define-private (validate-status-transition (current (string-ascii 20)) (new (string-ascii 20)))
  (if (or
        (and (is-eq current "active") (or (is-eq new "recalled") (is-eq new "quarantined")))
        (and (is-eq current "quarantined") (is-eq new "destroyed")))
    (ok true)
    (err ERR-INVALID-STATUS-TRANSITION))
)

(define-public (initialize-registry (registry principal))
  (begin
    (asserts! (is-none (var-get registry-contract)) (err ERR-CONTRACT-NOT-INITIALIZED))
    (var-set registry-contract (some registry))
    (ok true))
)

(define-public (create-trace (batch-id uint) (initial-status (string-ascii 20)))
  (let ((trace-id (var-get next-trace-id))
        (caller tx-sender)
        (user-info (try! (validate-role caller))))
    (asserts! (is-some (var-get registry-contract)) (err ERR-CONTRACT-NOT-INITIALIZED))
    (asserts! (is-none (map-get? trace-index batch-id)) (err ERR-STEP-EXISTS))
    (try! (validate-status initial-status))
    (map-set batch-traces trace-id
      {
        batch-id: batch-id,
        locked: false,
        status: initial-status,
        created-at: block-height,
        updated-at: block-height,
        creator: caller
      })
    (map-set trace-index batch-id trace-id)
    (var-set next-trace-id (+ trace-id u1))
    (print { event: "trace-created", trace-id: trace-id, batch-id: batch-id })
    (ok trace-id))
)

(define-public (add-step
  (trace-id uint)
  (action (string-ascii 50))
  (location (string-utf8 100))
  (quantity uint)
  (ipfs-hash (string-ascii 46))
  (notes (string-utf8 256)))
  (let ((trace (unwrap! (map-get? batch-traces trace-id) (err ERR-BATCH-NOT-FOUND)))
        (caller tx-sender)
        (user-info (try! (validate-role caller)))
        (role (get role user-info))
        (step-count (len (filter is-some (map (lambda (i) (map-get? trace-steps { trace-id: trace-id, step-index: i })) (range u0 u50))))))
    (asserts! (not (get locked trace)) (err ERR-TRACE-LOCKED))
    (asserts! (< step-count (var-get max-steps-per-batch)) (err ERR-STEP-LIMIT))
    (try! (validate-action action))
    (try! (validate-location location))
    (try! (validate-quantity quantity))
    (try! (validate-ipfs-hash ipfs-hash))
    (map-set trace-steps
      { trace-id: trace-id, step-index: step-count }
      {
        actor: caller,
        role: role,
        action: action,
        location: location,
        quantity: quantity,
        ipfs-hash: ipfs-hash,
        timestamp: block-height,
        notes: notes
      })
    (map-set batch-traces trace-id
      (merge trace { updated-at: block-height }))
    (print { event: "step-added", trace-id: trace-id, step-index: step-count, action: action })
    (ok step-count))
)

(define-public (update-status (trace-id uint) (new-status (string-ascii 20)))
  (let ((trace (unwrap! (map-get? batch-traces trace-id) (err ERR-BATCH-NOT-FOUND)))
        (caller tx-sender)
        (user-info (try! (validate-role caller)))
        (current-status (get status trace)))
    (asserts! (or (is-eq (get role user-info) "regulator") (is-eq caller (get creator trace))) (err ERR-NOT-AUTHORIZED))
    (try! (validate-status new-status))
    (try! (validate-status-transition current-status new-status))
    (map-set batch-traces trace-id
      (merge trace { status: new-status, updated-at: block-height }))
    (print { event: "status-updated", trace-id: trace-id, status: new-status })
    (ok true))
)

(define-public (lock-trace (trace-id uint))
  (let ((trace (unwrap! (map-get? batch-traces trace-id) (err ERR-BATCH-NOT-FOUND)))
        (caller tx-sender)
        (user-info (try! (validate-role caller))))
    (asserts! (is-eq (get role user-info) "regulator") (err ERR-NOT-AUTHORIZED))
    (map-set batch-traces trace-id
      (merge trace { locked: true, updated-at: block-height }))
    (print { event: "trace-locked", trace-id: trace-id })
    (ok true))
)

(define-public (get-full-trace (trace-id uint))
  (let ((trace (unwrap! (map-get? batch-traces trace-id) (err ERR-BATCH-NOT-FOUND)))
        (steps (map (lambda (i) (map-get? trace-steps { trace-id: trace-id, step-index: i })) (range u0 (var-get max-steps-per-batch)))))
    (ok { trace: trace, steps: (filter is-some steps) }))
)