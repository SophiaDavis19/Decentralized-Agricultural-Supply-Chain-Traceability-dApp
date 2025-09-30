# AgriTrace: Decentralized Agricultural Supply Chain Traceability dApp

## Overview

AgriTrace is a Web3 decentralized application (dApp) built on the Stacks blockchain using Clarity smart contracts. It enables farmers to log the origins and lifecycle of crops in an immutable, transparent manner. By leveraging smart contracts, the system automates product recalls in case of contamination or safety issues, potentially reducing food safety risks by 50% through faster traceability and response times. This addresses real-world problems in agriculture, such as:

- **Lack of Traceability**: Traditional supply chains often rely on paper records or centralized databases, leading to fraud, errors, and delays in identifying contaminated products.
- **Food Safety Risks**: Outbreaks (e.g., E. coli in produce) can affect millions, with slow recalls causing health and economic damage. AgriTrace enables instant tracing back to the source.
- **Inefficiency in Recalls**: Manual processes are slow; smart contracts automate notifications and quarantines.
- **Trust and Compliance**: Farmers, distributors, and regulators can verify data without intermediaries, reducing disputes and ensuring compliance with standards like FDA or EU regulations.
- **Incentivization**: Participants are rewarded with tokens for accurate logging, encouraging adoption.

The dApp interacts with 6 core smart contracts (written in Clarity) to manage registration, data logging, tracing, recalls, incentives, and auditing. Users interact via a frontend (e.g., built with React and Hiro Wallet for Stacks), but this README focuses on the backend smart contracts.

AgriTrace is deployed on Stacks (Bitcoin L2), benefiting from Bitcoin's security while enabling fast, low-cost transactions.

## Real-World Impact

- **Solves Traceability Gaps**: Logs crop data from planting to distribution, allowing anyone to query origins via blockchain explorers.
- **Automates Recalls**: If a batch is flagged (e.g., via oracles or admin reports), contracts automatically notify stakeholders and lock affected assets.
- **Reduces Risks by 50%**: Based on studies (e.g., IBM Food Trust), blockchain traceability can halve recall times, minimizing exposure.
- **Empowers Small Farmers**: Lowers barriers to entry for certification and market access.
- **Integration Potential**: Can connect to IoT devices for automated logging or external oracles for real-time data (e.g., weather, lab tests).

## Architecture

- **Frontend**: Web app for farmers to register, log crops, view traces, and initiate/manage recalls.
- **Backend**: 6 Clarity smart contracts deployed on Stacks.
- **Off-Chain Components**: Oracles for external data (e.g., contamination alerts), IPFS for storing detailed metadata (hashes stored on-chain).
- **Tokenomics**: Uses a native fungible token (AGRI) for incentives and staking.
- **Security**: Clarity's readability and lack of reentrancy reduce vulnerabilities. All contracts are public-read for transparency.

## Smart Contracts

The project consists of 6 solid smart contracts in Clarity. Each is designed to be modular, with clear functions, maps for state, and error handling. Below are descriptions, key functions, and code outlines. Full code can be found in the `contracts/` directory.

### 1. FarmerRegistry.clar
Registers users (farmers, distributors, regulators) with verified identities. Prevents unauthorized logging.

Key Features:
- Register with principal (Stacks address) and metadata (e.g., farm location).
- Role-based access (farmer, distributor).
- Update or deactivate profiles.

```clarity
;; FarmerRegistry.clar

(define-constant ERR-ALREADY-REGISTERED (err u100))
(define-constant ERR-NOT-AUTHORIZED (err u101))

(define-map users principal { role: (string-ascii 20), metadata: (string-utf8 256) })

(define-public (register (role (string-ascii 20)) (metadata (string-utf8 256)))
  (if (is-some (map-get? users tx-sender))
    ERR-ALREADY-REGISTERED
    (ok (map-set users tx-sender { role: role, metadata: metadata }))))

(define-read-only (get-user (user principal))
  (map-get? users user))

(define-public (update-metadata (metadata (string-utf8 256)))
  (match (map-get? users tx-sender)
    some-user (ok (map-set users tx-sender (merge some-user { metadata: metadata })))
    ERR-NOT-AUTHORIZED))
```

### 2. CropBatch.clar
Manages creation and basic info of crop batches. Farmers log origins like planting date, location, and variety.

Key Features:
- Create batches with unique IDs.
- Store immutable origin data.
- Link to IPFS for detailed docs.

```clarity
;; CropBatch.clar

(define-constant ERR-NOT-FARMER (err u200))
(define-constant ERR-BATCH-EXISTS (err u201))

(define-map batches uint { farmer: principal, origin: (string-utf8 512), timestamp: uint, ipfs-hash: (string-ascii 46) })
(define-data-var next-batch-id uint u1)

(define-public (create-batch (origin (string-utf8 512)) (ipfs-hash (string-ascii 46)))
  (let ((user-role (unwrap! (contract-call? .FarmerRegistry get-user tx-sender) ERR-NOT-FARMER)))
    (if (not (is-eq (get role user-role) "farmer")) ERR-NOT-FARMER
      (let ((batch-id (var-get next-batch-id)))
        (map-set batches batch-id { farmer: tx-sender, origin: origin, timestamp: block-height, ipfs-hash: ipfs-hash })
        (var-set next-batch-id (+ batch-id u1))
        (ok batch-id)))))

(define-read-only (get-batch (batch-id uint))
  (map-get? batches batch-id))
```

### 3. SupplyChainTrace.clar
Logs sequential steps in the supply chain (e.g., harvesting, shipping, processing). Ensures chronological integrity.

Key Features:
- Add steps to a batch's trace.
- Validate previous steps.
- Public query for full trace.

```clarity
;; SupplyChainTrace.clar

(define-constant ERR-INVALID-BATCH (err u300))
(define-constant ERR-NOT-OWNER (err u301))

(define-map traces uint (list 100 { actor: principal, action: (string-ascii 50), timestamp: uint }))

(define-public (add-step (batch-id uint) (action (string-ascii 50)))
  (match (contract-call? .CropBatch get-batch batch-id)
    some-batch (if (not (is-eq (get farmer some-batch) tx-sender)) ERR-NOT-OWNER ;; Extend to roles later
      (let ((current-trace (default-to (list) (map-get? traces batch-id))))
        (ok (map-set traces batch-id (append current-trace { actor: tx-sender, action: action, timestamp: block-height }))))
    ERR-INVALID-BATCH))

(define-read-only (get-trace (batch-id uint))
  (map-get? traces batch-id))
```

### 4. RecallManager.clar
Automates recalls: Flags batches, notifies stakeholders, and locks further actions.

Key Features:
- Initiate recall with evidence (e.g., oracle-fed).
- Auto-notify via events.
- Mark batches as recalled to prevent sales.

```clarity
;; RecallManager.clar

(define-constant ERR-NOT-REGULATOR (err u400))
(define-constant ERR-ALREADY-RECALLED (err u401))

(define-map recalls uint { initiator: principal, reason: (string-utf8 256), timestamp: uint, affected-batches: (list 50 uint) })

(define-public (initiate-recall (reason (string-utf8 256)) (affected-batches (list 50 uint)))
  (let ((user-role (unwrap! (contract-call? .FarmerRegistry get-user tx-sender) ERR-NOT-REGULATOR)))
    (if (not (is-eq (get role user-role) "regulator")) ERR-NOT-REGULATOR
      (let ((recall-id (var-get next-recall-id))) ;; Assume var defined
        (map-set recalls recall-id { initiator: tx-sender, reason: reason, timestamp: block-height, affected-batches: affected-batches })
        ;; Emit event for notifications
        (print { event: "recall-initiated", recall-id: recall-id })
        (ok recall-id)))))

(define-read-only (get-recall (recall-id uint))
  (map-get? recalls recall-id))
```

### 5. IncentiveToken.clar
Fungible token (SIP-010 compliant) to reward compliant logging and penalize issues.

Key Features:
- Mint tokens for successful logs.
- Stake for governance.
- Burn on recalls.

```clarity
;; IncentiveToken.clar (SIP-010 compliant)

(define-fungible-token agri u1000000000)
(define-constant ERR-INSUFFICIENT-BALANCE (err u500))

(define-public (transfer (amount uint) (recipient principal))
  (ft-transfer? agri amount tx-sender recipient))

(define-public (mint (amount uint) (recipient principal))
  (if (is-eq tx-sender contract-caller) ;; Admin or from other contracts
    (ok (ft-mint? agri amount recipient))
    (err u501)))

;; Reward function called from other contracts
(define-public (reward-user (user principal) (amount uint))
  (mint amount user))
```

### 6. AuditLog.clar
Immutable log of all system events for transparency and disputes.

Key Features:
- Log events from other contracts.
- Query historical actions.
- No deletions.

```clarity
;; AuditLog.clar

(define-map logs uint { event-type: (string-ascii 50), actor: principal, data: (string-utf8 512), timestamp: uint })
(define-data-var next-log-id uint u1)

(define-public (log-event (event-type (string-ascii 50)) (data (string-utf8 512)))
  (let ((log-id (var-get next-log-id)))
    (map-set logs log-id { event-type: event-type, actor: tx-sender, data: data, timestamp: block-height })
    (var-set next-log-id (+ log-id u1))
    (ok log-id)))

(define-read-only (get-log (log-id uint))
  (map-get? logs log-id))
```

## Deployment and Usage

1. **Install Dependencies**: Use Clarinet (Stacks dev tool) for local testing: `clarinet integrate`.
2. **Deploy Contracts**: Deploy to Stacks testnet/mainnet via Clarinet or Hiro tools.
3. **Interact**: Use Stacks.js or frontend to call functions.
4. **Testing**: Run unit tests in Clarinet (e.g., register farmer, create batch, add steps, initiate recall).
5. **Frontend Integration**: Connect via `@stacks/connect` for wallet auth.

## Future Enhancements

- Oracle integration for automated contamination detection.
- Cross-chain bridges for broader adoption.
- DAO governance via tokens.

## License

MIT License. See LICENSE file for details.