crop-batch.clar
(define-constant ERR-NOT-AUTHORIZED (err u100))
(define-constant ERR-INVALID-ORIGIN (err u101))
(define-constant ERR-INVALID-IPFS-HASH (err u102))
(define-constant ERR-INVALID-CROP-TYPE (err u103))
(define-constant ERR-INVALID-PLANTING-DATE (err u104))
(define-constant ERR-INVALID-HARVEST-DATE (err u105))
(define-constant ERR-BATCH-ALREADY-EXISTS (err u106))
(define-constant ERR-BATCH-NOT-FOUND (err u107))
(define-constant ERR-INVALID-TIMESTAMP (err u108))
(define-constant ERR-AUTHORITY-NOT-VERIFIED (err u109))
(define-constant ERR-INVALID-QUANTITY (err u110))
(define-constant ERR-INVALID-LOCATION (err u111))
(define-constant ERR-BATCH-UPDATE-NOT-ALLOWED (err u112))
(define-constant ERR-INVALID-UPDATE-PARAM (err u113))
(define-constant ERR-MAX-BATCHES-EXCEEDED (err u114))
(define-constant ERR-INVALID-CERTIFICATION (err u115))
(define-constant ERR-INVALID-SOIL-QUALITY (err u116))
(define-constant ERR-INVALID-PESTICIDE-USE (err u117))
(define-constant ERR-INVALID-FERTILIZER-USE (err u118))
(define-constant ERR-INVALID-STATUS (err u119))
(define-constant ERR-INVALID-CURRENCY (err u120))

(define-data-var next-batch-id uint u0)
(define-data-var max-batches uint u10000)
(define-data-var creation-fee uint u500)
(define-data-var authority-contract (optional principal) none)

(define-map batches
  uint
  {
    farmer: principal,
    origin: (string-utf8 512),
    timestamp: uint,
    ipfs-hash: (string-ascii 46),
    crop-type: (string-utf8 50),
    planting-date: uint,
    harvest-date: uint,
    quantity: uint,
    location: (string-utf8 100),
    certification: (string-utf8 50),
    soil-quality: (string-utf8 50),
    pesticide-use: bool,
    fertilizer-use: bool,
    status: bool,
    currency: (string-utf8 20)
  }
)

(define-map batches-by-origin
  (string-utf8 512)
  uint)

(define-map batch-updates
  uint
  {
    update-origin: (string-utf8 512),
    update-quantity: uint,
    update-timestamp: uint,
    updater: principal
  }
)

(define-read-only (get-batch (id uint))
  (map-get? batches id)
)

(define-read-only (get-batch-updates (id uint))
  (map-get? batch-updates id)
)

(define-read-only (is-batch-registered (origin (string-utf8 512)))
  (is-some (map-get? batches-by-origin origin))
)

(define-private (validate-origin (origin (string-utf8 512)))
  (if (and (> (len origin) u0) (<= (len origin) u512))
      (ok true)
      (err ERR-INVALID-ORIGIN))
)

(define-private (validate-ipfs-hash (hash (string-ascii 46)))
  (if (and (> (len hash) u0) (<= (len hash) u46))
      (ok true)
      (err ERR-INVALID-IPFS-HASH))
)

(define-private (validate-crop-type (type (string-utf8 50)))
  (if (and (> (len type) u0) (<= (len type) u50))
      (ok true)
      (err ERR-INVALID-CROP-TYPE))
)

(define-private (validate-planting-date (date uint))
  (if (< date block-height)
      (ok true)
      (err ERR-INVALID-PLANTING-DATE))
)

(define-private (validate-harvest-date (date uint))
  (if (> date block-height)
      (ok true)
      (err ERR-INVALID-HARVEST-DATE))
)

(define-private (validate-quantity (qty uint))
  (if (> qty u0)
      (ok true)
      (err ERR-INVALID-QUANTITY))
)

(define-private (validate-location (loc (string-utf8 100)))
  (if (and (> (len loc) u0) (<= (len loc) u100))
      (ok true)
      (err ERR-INVALID-LOCATION))
)

(define-private (validate-certification (cert (string-utf8 50)))
  (if (<= (len cert) u50)
      (ok true)
      (err ERR-INVALID-CERTIFICATION))
)

(define-private (validate-soil-quality (quality (string-utf8 50)))
  (if (<= (len quality) u50)
      (ok true)
      (err ERR-INVALID-SOIL-QUALITY))
)

(define-private (validate-timestamp (ts uint))
  (if (>= ts block-height)
      (ok true)
      (err ERR-INVALID-TIMESTAMP))
)

(define-private (validate-currency (cur (string-utf8 20)))
  (if (or (is-eq cur "STX") (is-eq cur "USD") (is-eq cur "BTC"))
      (ok true)
      (err ERR-INVALID-CURRENCY))
)

(define-private (validate-principal (p principal))
  (if (not (is-eq p 'SP000000000000000000002Q6VF78))
      (ok true)
      (err ERR-NOT-AUTHORIZED))
)

(define-public (set-authority-contract (contract-principal principal))
  (begin
    (asserts! (not (is-eq contract-principal 'SP000000000000000000002Q6VF78)) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-none (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set authority-contract (some contract-principal))
    (ok true)
  )
)

(define-public (set-max-batches (new-max uint))
  (begin
    (asserts! (> new-max u0) (err ERR-MAX-BATCHES-EXCEEDED))
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set max-batches new-max)
    (ok true)
  )
)

(define-public (set-creation-fee (new-fee uint))
  (begin
    (asserts! (>= new-fee u0) (err ERR-INVALID-UPDATE-PARAM))
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set creation-fee new-fee)
    (ok true)
  )
)

(define-public (create-batch
  (origin (string-utf8 512))
  (ipfs-hash (string-ascii 46))
  (crop-type (string-utf8 50))
  (planting-date uint)
  (harvest-date uint)
  (quantity uint)
  (location (string-utf8 100))
  (certification (string-utf8 50))
  (soil-quality (string-utf8 50))
  (pesticide-use bool)
  (fertilizer-use bool)
  (currency (string-utf8 20))
)
  (let (
        (next-id (var-get next-batch-id))
        (current-max (var-get max-batches))
        (authority (var-get authority-contract))
      )
    (asserts! (< next-id current-max) (err ERR-MAX-BATCHES-EXCEEDED))
    (asserts! (> (len origin) u0) (err ERR-INVALID-ORIGIN))
    (asserts! (<= (len origin) u512) (err ERR-INVALID-ORIGIN))
    (asserts! (> (len ipfs-hash) u0) (err ERR-INVALID-IPFS-HASH))
    (asserts! (<= (len ipfs-hash) u46) (err ERR-INVALID-IPFS-HASH))
    (asserts! (> (len crop-type) u0) (err ERR-INVALID-CROP-TYPE))
    (asserts! (<= (len crop-type) u50) (err ERR-INVALID-CROP-TYPE))
    (asserts! (< planting-date block-height) (err ERR-INVALID-PLANTING-DATE))
    (asserts! (> harvest-date block-height) (err ERR-INVALID-HARVEST-DATE))
    (asserts! (> quantity u0) (err ERR-INVALID-QUANTITY))
    (asserts! (> (len location) u0) (err ERR-INVALID-LOCATION))
    (asserts! (<= (len location) u100) (err ERR-INVALID-LOCATION))
    (asserts! (<= (len certification) u50) (err ERR-INVALID-CERTIFICATION))
    (asserts! (<= (len soil-quality) u50) (err ERR-INVALID-SOIL-QUALITY))
    (asserts! (or (is-eq currency "STX") (is-eq currency "USD") (is-eq currency "BTC")) (err ERR-INVALID-CURRENCY))
    (asserts! (is-none (map-get? batches-by-origin origin)) (err ERR-BATCH-ALREADY-EXISTS))
    (let ((authority-recipient (unwrap! authority (err ERR-AUTHORITY-NOT-VERIFIED))))
      (try! (stx-transfer? (var-get creation-fee) tx-sender authority-recipient))
    )
    (map-set batches next-id
      {
        farmer: tx-sender,
        origin: origin,
        timestamp: block-height,
        ipfs-hash: ipfs-hash,
        crop-type: crop-type,
        planting-date: planting-date,
        harvest-date: harvest-date,
        quantity: quantity,
        location: location,
        certification: certification,
        soil-quality: soil-quality,
        pesticide-use: pesticide-use,
        fertilizer-use: fertilizer-use,
        status: true,
        currency: currency
      }
    )
    (map-set batches-by-origin origin next-id)
    (var-set next-batch-id (+ next-id u1))
    (print { event: "batch-created", id: next-id })
    (ok next-id)
  )
)

(define-public (update-batch
  (batch-id uint)
  (update-origin (string-utf8 512))
  (update-quantity uint)
)
  (let ((batch (map-get? batches batch-id)))
    (match batch
      b
        (begin
          (asserts! (is-eq (get farmer b) tx-sender) (err ERR-NOT-AUTHORIZED))
          (asserts! (> (len update-origin) u0) (err ERR-INVALID-ORIGIN))
          (asserts! (<= (len update-origin) u512) (err ERR-INVALID-ORIGIN))
          (asserts! (> update-quantity u0) (err ERR-INVALID-QUANTITY))
          (let ((existing (map-get? batches-by-origin update-origin)))
            (match existing
              existing-id
                (asserts! (is-eq existing-id batch-id) (err ERR-BATCH-ALREADY-EXISTS))
              (begin true)
            )
          )
          (let ((old-origin (get origin b)))
            (if (is-eq old-origin update-origin)
                (ok true)
                (begin
                  (map-delete batches-by-origin old-origin)
                  (map-set batches-by-origin update-origin batch-id)
                  (ok true)
                )
            )
          )
          (map-set batches batch-id
            {
              farmer: (get farmer b),
              origin: update-origin,
              timestamp: block-height,
              ipfs-hash: (get ipfs-hash b),
              crop-type: (get crop-type b),
              planting-date: (get planting-date b),
              harvest-date: (get harvest-date b),
              quantity: update-quantity,
              location: (get location b),
              certification: (get certification b),
              soil-quality: (get soil-quality b),
              pesticide-use: (get pesticide-use b),
              fertilizer-use: (get fertilizer-use b),
              status: (get status b),
              currency: (get currency b)
            }
          )
          (map-set batch-updates batch-id
            {
              update-origin: update-origin,
              update-quantity: update-quantity,
              update-timestamp: block-height,
              updater: tx-sender
            }
          )
          (print { event: "batch-updated", id: batch-id })
          (ok true)
        )
      (err ERR-BATCH-NOT-FOUND)
    )
  )
)

(define-public (get-batch-count)
  (ok (var-get next-batch-id))
)

(define-public (check-batch-existence (origin (string-utf8 512)))
  (ok (is-batch-registered origin))
)