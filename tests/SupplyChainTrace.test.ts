// tests/supply-chain-trace.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Cl, ClarityValue, uintCV, stringAsciiCV, stringUtf8CV, someCV, noneCV, tupleCV, listCV, Response } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_BATCH = 101;
const ERR_BATCH_NOT_FOUND = 102;
const ERR_STEP_EXISTS = 103;
const ERR_INVALID_ACTOR = 104;
const ERR_INVALID_ACTION = 105;
const ERR_INVALID_TIMESTAMP = 106;
const ERR_STEP_LIMIT = 107;
const ERR_ROLE_NOT_REGISTERED = 108;
const ERR_CONTRACT_NOT_INITIALIZED = 109;
const ERR_IPFS_HASH = 110;
const ERR_LOCATION = 111;
const ERR_QUANTITY = 112;
const ERR_STATUS = 113;
const ERR_TRACE_LOCKED = 114;
const ERR_INVALID_STATUS_TRANSITION = 115;

const validIpfsHash = "QmXoypizjW3QQQoBJzA123456789abcdef123456789abc";

interface Trace {
  "batch-id": bigint;
  locked: boolean;
  status: string;
  "created-at": bigint;
  "updated-at": bigint;
  creator: string;
}

interface Step {
  actor: string;
  role: string;
  action: string;
  location: string;
  quantity: bigint;
  "ipfs-hash": string;
  timestamp: bigint;
  notes: string;
}

interface FullTrace {
  trace: Trace;
  steps: Step[];
}

class RegistryMock {
  users: Map<string, { role: string; metadata: string }> = new Map();
  constructor() {
    this.users.set("ST1FARMER", { role: "farmer", metadata: "Farm A" });
    this.users.set("ST2PROCESSOR", { role: "processor", metadata: "Plant B" });
    this.users.set("ST3DISTRIBUTOR", { role: "distributor", metadata: "Hub C" });
    this.users.set("ST4REGULATOR", { role: "regulator", metadata: "Gov D" });
  }
  getUser(principal: string) {
    return this.users.get(principal) || null;
  }
}

class SupplyChainTraceMock {
  state: {
    nextTraceId: bigint;
    registryContract: string | null;
    maxStepsPerBatch: bigint;
    batchTraces: Map<bigint, Trace>;
    traceSteps: Map<string, Step>;
    traceIndex: Map<bigint, bigint>;
    blockHeight: bigint;
    caller: string;
    events: Array<{ event: string; data: any }>;
  };

  registry: RegistryMock;

  constructor() {
    this.registry = new RegistryMock();
    this.reset();
  }

  reset() {
    this.state = {
      nextTraceId: 1n,
      registryContract: null,
      maxStepsPerBatch: 50n,
      batchTraces: new Map(),
      traceSteps: new Map(),
      traceIndex: new Map(),
      blockHeight: 100n,
      caller: "ST1FARMER",
      events: [],
    };
  }

  setCaller(principal: string) {
    this.state.caller = principal;
  }

  setBlockHeight(height: bigint) {
    this.state.blockHeight = height;
  }

  print(event: string, data: any) {
    this.state.events.push({ event, data });
  }

  initializeRegistry(registry: string): Response<boolean, number> {
    if (this.state.registryContract !== null) {
      return { success: false, error: ERR_CONTRACT_NOT_INITIALIZED };
    }
    this.state.registryContract = registry;
    return { success: true, result: true };
  }

  createTrace(batchId: bigint, initialStatus: string): Response<bigint, number> {
    if (!this.state.registryContract) {
      return { success: false, error: ERR_CONTRACT_NOT_INITIALIZED };
    }
    if (this.state.traceIndex.has(batchId)) {
      return { success: false, error: ERR_STEP_EXISTS };
    }
    if (!["active", "recalled", "quarantined", "destroyed"].includes(initialStatus)) {
      return { success: false, error: ERR_STATUS };
    }
    const user = this.registry.getUser(this.state.caller);
    if (!user) {
      return { success: false, error: ERR_ROLE_NOT_REGISTERED };
    }
    const traceId = this.state.nextTraceId;
    const trace: Trace = {
      "batch-id": batchId,
      locked: false,
      status: initialStatus,
      "created-at": this.state.blockHeight,
      "updated-at": this.state.blockHeight,
      creator: this.state.caller,
    };
    this.state.batchTraces.set(traceId, trace);
    this.state.traceIndex.set(batchId, traceId);
    this.state.nextTraceId += 1n;
    this.print("trace-created", { traceId, batchId });
    return { success: true, result: traceId };
  }

  addStep(
    traceId: bigint,
    action: string,
    location: string,
    quantity: bigint,
    ipfsHash: string,
    notes: string
  ): Response<bigint, number> {
    const trace = this.state.batchTraces.get(traceId);
    if (!trace) {
      return { success: false, error: ERR_BATCH_NOT_FOUND };
    }
    if (trace.locked) {
      return { success: false, error: ERR_TRACE_LOCKED };
    }
    const user = this.registry.getUser(this.state.caller);
    if (!user) {
      return { success: false, error: ERR_ROLE_NOT_REGISTERED };
    }
    const validActions = ["plant", "harvest", "process", "package", "ship", "receive", "store", "retail"];
    if (!validActions.includes(action)) {
      return { success: false, error: ERR_INVALID_ACTION };
    }
    if (location.length === 0 || location.length > 100) {
      return { success: false, error: ERR_LOCATION };
    }
    if (quantity <= 0n) {
      return { success: false, error: ERR_QUANTITY };
    }
    if (ipfsHash.length !== 46 || ipfsHash[0] !== "Q") {
      return { success: false, error: ERR_IPFS_HASH };
    }
    const stepCount = Array.from(this.state.traceSteps.keys())
      .filter(k => k.startsWith(`${traceId}-`))
      .length;
    if (stepCount >= Number(this.state.maxStepsPerBatch)) {
      return { success: false, error: ERR_STEP_LIMIT };
    }
    const stepIndex = BigInt(stepCount);
    const stepKey = `${traceId}-${stepIndex}`;
    const step: Step = {
      actor: this.state.caller,
      role: user.role,
      action,
      location,
      quantity,
      "ipfs-hash": ipfsHash,
      timestamp: this.state.blockHeight,
      notes,
    };
    this.state.traceSteps.set(stepKey, step);
    const updatedTrace = { ...trace, "updated-at": this.state.blockHeight };
    this.state.batchTraces.set(traceId, updatedTrace);
    this.print("step-added", { traceId, stepIndex, action });
    return { success: true, result: stepIndex };
  }

  updateStatus(traceId: bigint, newStatus: string): Response<boolean, number> {
    const trace = this.state.batchTraces.get(traceId);
    if (!trace) {
      return { success: false, error: ERR_BATCH_NOT_FOUND };
    }
    const user = this.registry.getUser(this.state.caller);
    if (!user || (user.role !== "regulator" && this.state.caller !== trace.creator)) {
      return { success: false, error: ERR_NOT_AUTHORIZED };
    }
    if (!["active", "recalled", "quarantined", "destroyed"].includes(newStatus)) {
      return { success: false, error: ERR_STATUS };
    }
    const current = trace.status;
    const valid = (current === "active" && (newStatus === "recalled" || newStatus === "quarantined")) ||
                  (current === "quarantined" && newStatus === "destroyed");
    if (!valid) {
      return { success: false, error: ERR_INVALID_STATUS_TRANSITION };
    }
    const updated = { ...trace, status: newStatus, "updated-at": this.state.blockHeight };
    this.state.batchTraces.set(traceId, updated);
    this.print("status-updated", { traceId, status: newStatus });
    return { success: true, result: true };
  }

  lockTrace(traceId: bigint): Response<boolean, number> {
    const trace = this.state.batchTraces.get(traceId);
    if (!trace) {
      return { success: false, error: ERR_BATCH_NOT_FOUND };
    }
    const user = this.registry.getUser(this.state.caller);
    if (!user || user.role !== "regulator") {
      return { success: false, error: ERR_NOT_AUTHORIZED };
    }
    const updated = { ...trace, locked: true, "updated-at": this.state.blockHeight };
    this.state.batchTraces.set(traceId, updated);
    this.print("trace-locked", { traceId });
    return { success: true, result: true };
  }

  getFullTrace(traceId: bigint): FullTrace | null {
    const trace = this.state.batchTraces.get(traceId);
    if (!trace) return null;
    const steps: Step[] = [];
    for (let i = 0; i < Number(this.state.maxStepsPerBatch); i++) {
      const step = this.state.traceSteps.get(`${traceId}-${i}`);
      if (step) steps.push(step);
    }
    return { trace, steps };
  }
}

describe("supply-chain-trace.clar", () => {
  let mock: SupplyChainTraceMock;

  beforeEach(() => {
    mock = new SupplyChainTraceMock();
    mock.reset();
  });

  it("initializes registry successfully", () => {
    const result = mock.initializeRegistry("ST1REGISTRY");
    expect(result.success).toBe(true);
    expect(mock.state.registryContract).toBe("ST1REGISTRY");
  });

  it("rejects double initialization", () => {
    mock.initializeRegistry("ST1REGISTRY");
    const result = mock.initializeRegistry("ST2REGISTRY");
    expect(result.success).toBe(false);
    expect(result.error).toBe(ERR_CONTRACT_NOT_INITIALIZED);
  });

  it("creates trace for valid batch", () => {
    mock.initializeRegistry("ST1REGISTRY");
    const result = mock.createTrace(1001n, "active");
    expect(result.success).toBe(true);
    expect(result.result).toBe(1n);
    const trace = mock.state.batchTraces.get(1n);
    expect(trace?.["batch-id"]).toBe(1001n);
    expect(trace?.status).toBe("active");
    expect(trace?.creator).toBe("ST1FARMER");
  });

  it("rejects trace creation without registry", () => {
    const result = mock.createTrace(1001n, "active");
    expect(result.success).toBe(false);
    expect(result.error).toBe(ERR_CONTRACT_NOT_INITIALIZED);
  });

  it("rejects duplicate batch trace", () => {
    mock.initializeRegistry("ST1REGISTRY");
    mock.createTrace(1001n, "active");
    const result = mock.createTrace(1001n, "active");
    expect(result.success).toBe(false);
    expect(result.error).toBe(ERR_STEP_EXISTS);
  });

  it("rejects invalid status on creation", () => {
    mock.initializeRegistry("ST1REGISTRY");
    const result = mock.createTrace(1001n, "invalid");
    expect(result.success).toBe(false);
    expect(result.error).toBe(ERR_STATUS);
  });

  it("adds step to trace successfully", () => {
    mock.initializeRegistry("ST1REGISTRY");
    mock.createTrace(1001n, "active");
    const result = mock.addStep(
      1n,
      "harvest",
      "Farm Location A",
      500n,
      validIpfsHash,
      "Harvested under clear conditions"
    );
    expect(result.success).toBe(true);
    expect(result.result).toBe(0n);
    const step = mock.state.traceSteps.get("1-0");
    expect(step?.action).toBe("harvest");
    expect(step?.quantity).toBe(500n);
    expect(step?.actor).toBe("ST1FARMER");
  });

  it("rejects step on locked trace", () => {
    mock.initializeRegistry("ST1REGISTRY");
    mock.createTrace(1001n, "active");
    mock.setCaller("ST4REGULATOR");
    mock.lockTrace(1n);
    mock.setCaller("ST1FARMER");
    const result = mock.addStep(1n, "harvest", "Loc", 100n, validIpfsHash, "");
    expect(result.success).toBe(false);
    expect(result.error).toBe(ERR_TRACE_LOCKED);
  });

  it("rejects step with invalid action", () => {
    mock.initializeRegistry("ST1REGISTRY");
    mock.createTrace(1001n, "active");
    const result = mock.addStep(1n, "invalid", "Loc", 100n, validIpfsHash, "");
    expect(result.success).toBe(false);
    expect(result.error).toBe(ERR_INVALID_ACTION);
  });

  it("rejects step with invalid IPFS hash", () => {
    mock.initializeRegistry("ST1REGISTRY");
    mock.createTrace(1001n, "active");
    const result = mock.addStep(1n, "harvest", "Loc", 100n, "InvalidHash", "");
    expect(result.success).toBe(false);
    expect(result.error).toBe(ERR_IPFS_HASH);
  });

  it("enforces step limit per batch", () => {
    mock.initializeRegistry("ST1REGISTRY");
    mock.createTrace(1001n, "active");
    for (let i = 0; i < 50; i++) {
      mock.addStep(1n, "process", `Loc${i}`, 100n, validIpfsHash, "");
    }
    const result = mock.addStep(1n, "ship", "Loc", 100n, validIpfsHash, "");
    expect(result.success).toBe(false);
    expect(result.error).toBe(ERR_STEP_LIMIT);
  });

  it("updates status from active to recalled", () => {
    mock.initializeRegistry("ST1REGISTRY");
    mock.createTrace(1001n, "active");
    mock.setCaller("ST4REGULATOR");
    const result = mock.updateStatus(1n, "recalled");
    expect(result.success).toBe(true);
    const trace = mock.state.batchTraces.get(1n);
    expect(trace?.status).toBe("recalled");
  });

  it("rejects invalid status transition", () => {
    mock.initializeRegistry("ST1REGISTRY");
    mock.createTrace(1001n, "active");
    mock.setCaller("ST4REGULATOR");
    const result = mock.updateStatus(1n, "destroyed");
    expect(result.success).toBe(false);
    expect(result.error).toBe(ERR_INVALID_STATUS_TRANSITION);
  });

  it("allows creator to update status", () => {
    mock.initializeRegistry("ST1REGISTRY");
    mock.createTrace(1001n, "active");
    const result = mock.updateStatus(1n, "quarantined");
    expect(result.success).toBe(true);
  });

  it("rejects non-regulator from locking", () => {
    mock.initializeRegistry("ST1REGISTRY");
    mock.createTrace(1001n, "active");
    const result = mock.lockTrace(1n);
    expect(result.success).toBe(false);
    expect(result.error).toBe(ERR_NOT_AUTHORIZED);
  });

  it("regulator can lock trace", () => {
    mock.initializeRegistry("ST1REGISTRY");
    mock.createTrace(1001n, "active");
    mock.setCaller("ST4REGULATOR");
    const result = mock.lockTrace(1n);
    expect(result.success).toBe(true);
    const trace = mock.state.batchTraces.get(1n);
    expect(trace?.locked).toBe(true);
  });

  it("retrieves full trace with multiple steps", () => {
    mock.initializeRegistry("ST1REGISTRY");
    mock.createTrace(1001n, "active");
    mock.addStep(1n, "plant", "Field A", 1000n, validIpfsHash, "Planted");
    mock.addStep(1n, "harvest", "Field A", 950n, validIpfsHash, "Harvested");
    const full = mock.getFullTrace(1n);
    expect(full).not.toBeNull();
    expect(full!.steps.length).toBe(2);
    expect(full!.steps[0].action).toBe("plant");
    expect(full!.steps[1].action).toBe("harvest");
  });

  it("emits correct events", () => {
    mock.initializeRegistry("ST1REGISTRY");
    mock.createTrace(1001n, "active");
    mock.addStep(1n, "harvest", "Loc", 500n, validIpfsHash, "");
    expect(mock.state.events).toContainEqual({
      event: "trace-created",
      data: { traceId: 1n, batchId: 1001n }
    });
    expect(mock.state.events).toContainEqual({
      event: "step-added",
      data: { traceId: 1n, stepIndex: 0n, action: "harvest" }
    });
  });

  it("handles different roles correctly", () => {
    mock.initializeRegistry("ST1REGISTRY");
    mock.setCaller("ST2PROCESSOR");
    const traceId = mock.createTrace(2001n, "active").result!;
    mock.addStep(traceId, "process", "Factory", 800n, validIpfsHash, "Processed");
    const step = mock.state.traceSteps.get(`${traceId}-0`);
    expect(step?.role).toBe("processor");
  });

  it("prevents unauthorized status update", () => {
    mock.initializeRegistry("ST1REGISTRY");
    mock.createTrace(1001n, "active");
    mock.setCaller("ST3DISTRIBUTOR");
    const result = mock.updateStatus(1n, "recalled");
    expect(result.success).toBe(false);
    expect(result.error).toBe(ERR_NOT_AUTHORIZED);
  });
});