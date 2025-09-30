// crop-batch-test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { stringUtf8CV, uintCV, stringAsciiCV, boolCV, ClarityType } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_ORIGIN = 101;
const ERR_INVALID_IPFS_HASH = 102;
const ERR_INVALID_CROP_TYPE = 103;
const ERR_INVALID_PLANTING_DATE = 104;
const ERR_INVALID_HARVEST_DATE = 105;
const ERR_BATCH_ALREADY_EXISTS = 106;
const ERR_BATCH_NOT_FOUND = 107;
const ERR_AUTHORITY_NOT_VERIFIED = 109;
const ERR_INVALID_QUANTITY = 110;
const ERR_INVALID_LOCATION = 111;
const ERR_MAX_BATCHES_EXCEEDED = 114;
const ERR_INVALID_CERTIFICATION = 115;
const ERR_INVALID_SOIL_QUALITY = 116;
const ERR_INVALID_CURRENCY = 120;

interface Batch {
  farmer: string;
  origin: string;
  timestamp: number;
  ipfsHash: string;
  cropType: string;
  plantingDate: number;
  harvestDate: number;
  quantity: number;
  location: string;
  certification: string;
  soilQuality: string;
  pesticideUse: boolean;
  fertilizerUse: boolean;
  status: boolean;
  currency: string;
}

interface BatchUpdate {
  updateOrigin: string;
  updateQuantity: number;
  updateTimestamp: number;
  updater: string;
}

type Result<T> = { ok: true; value: T } | { ok: false; value: number };

class CropBatchMock {
  state: {
    nextBatchId: number;
    maxBatches: number;
    creationFee: number;
    authorityContract: string | null;
    batches: Map<number, Batch>;
    batchUpdates: Map<number, BatchUpdate>;
    batchesByOrigin: Map<string, number>;
  } = {
    nextBatchId: 0,
    maxBatches: 10000,
    creationFee: 500,
    authorityContract: null,
    batches: new Map(),
    batchUpdates: new Map(),
    batchesByOrigin: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1TEST";
  authorities: Set<string> = new Set(["ST1TEST"]);
  stxTransfers: Array<{ amount: number; from: string; to: string | null }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      nextBatchId: 0,
      maxBatches: 10000,
      creationFee: 500,
      authorityContract: null,
      batches: new Map(),
      batchUpdates: new Map(),
      batchesByOrigin: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1TEST";
    this.authorities = new Set(["ST1TEST"]);
    this.stxTransfers = [];
  }

  isVerifiedAuthority(principal: string): Result<boolean> {
    return { ok: true, value: this.authorities.has(principal) };
  }

  setAuthorityContract(contractPrincipal: string): Result<boolean> {
    if (contractPrincipal === "SP000000000000000000002Q6VF78") {
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    }
    if (this.state.authorityContract !== null) {
      return { ok: false, value: ERR_AUTHORITY_NOT_VERIFIED };
    }
    this.state.authorityContract = contractPrincipal;
    return { ok: true, value: true };
  }

  setCreationFee(newFee: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: ERR_AUTHORITY_NOT_VERIFIED };
    this.state.creationFee = newFee;
    return { ok: true, value: true };
  }

  createBatch(
    origin: string,
    ipfsHash: string,
    cropType: string,
    plantingDate: number,
    harvestDate: number,
    quantity: number,
    location: string,
    certification: string,
    soilQuality: string,
    pesticideUse: boolean,
    fertilizerUse: boolean,
    currency: string
  ): Result<number> {
    if (this.state.nextBatchId >= this.state.maxBatches) return { ok: false, value: ERR_MAX_BATCHES_EXCEEDED };
    if (!origin || origin.length > 512) return { ok: false, value: ERR_INVALID_ORIGIN };
    if (!ipfsHash || ipfsHash.length > 46) return { ok: false, value: ERR_INVALID_IPFS_HASH };
    if (!cropType || cropType.length > 50) return { ok: false, value: ERR_INVALID_CROP_TYPE };
    if (plantingDate >= this.blockHeight) return { ok: false, value: ERR_INVALID_PLANTING_DATE };
    if (harvestDate <= this.blockHeight) return { ok: false, value: ERR_INVALID_HARVEST_DATE };
    if (quantity <= 0) return { ok: false, value: ERR_INVALID_QUANTITY };
    if (!location || location.length > 100) return { ok: false, value: ERR_INVALID_LOCATION };
    if (certification.length > 50) return { ok: false, value: ERR_INVALID_CERTIFICATION };
    if (soilQuality.length > 50) return { ok: false, value: ERR_INVALID_SOIL_QUALITY };
    if (!["STX", "USD", "BTC"].includes(currency)) return { ok: false, value: ERR_INVALID_CURRENCY };
    if (!this.isVerifiedAuthority(this.caller).value) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (this.state.batchesByOrigin.has(origin)) return { ok: false, value: ERR_BATCH_ALREADY_EXISTS };
    if (!this.state.authorityContract) return { ok: false, value: ERR_AUTHORITY_NOT_VERIFIED };

    this.stxTransfers.push({ amount: this.state.creationFee, from: this.caller, to: this.state.authorityContract });

    const id = this.state.nextBatchId;
    const batch: Batch = {
      farmer: this.caller,
      origin,
      timestamp: this.blockHeight,
      ipfsHash,
      cropType,
      plantingDate,
      harvestDate,
      quantity,
      location,
      certification,
      soilQuality,
      pesticideUse,
      fertilizerUse,
      status: true,
      currency,
    };
    this.state.batches.set(id, batch);
    this.state.batchesByOrigin.set(origin, id);
    this.state.nextBatchId++;
    return { ok: true, value: id };
  }

  getBatch(id: number): Batch | null {
    return this.state.batches.get(id) || null;
  }

  updateBatch(id: number, updateOrigin: string, updateQuantity: number): Result<boolean> {
    const batch = this.state.batches.get(id);
    if (!batch) return { ok: false, value: ERR_BATCH_NOT_FOUND };
    if (batch.farmer !== this.caller) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (!updateOrigin || updateOrigin.length > 512) return { ok: false, value: ERR_INVALID_ORIGIN };
    if (updateQuantity <= 0) return { ok: false, value: ERR_INVALID_QUANTITY };
    if (this.state.batchesByOrigin.has(updateOrigin) && this.state.batchesByOrigin.get(updateOrigin) !== id) {
      return { ok: false, value: ERR_BATCH_ALREADY_EXISTS };
    }

    const updated: Batch = {
      ...batch,
      origin: updateOrigin,
      quantity: updateQuantity,
      timestamp: this.blockHeight,
    };
    this.state.batches.set(id, updated);
    this.state.batchesByOrigin.delete(batch.origin);
    this.state.batchesByOrigin.set(updateOrigin, id);
    this.state.batchUpdates.set(id, {
      updateOrigin,
      updateQuantity,
      updateTimestamp: this.blockHeight,
      updater: this.caller,
    });
    return { ok: true, value: true };
  }

  getBatchCount(): Result<number> {
    return { ok: true, value: this.state.nextBatchId };
  }

  checkBatchExistence(origin: string): Result<boolean> {
    return { ok: true, value: this.state.batchesByOrigin.has(origin) };
  }
}

describe("CropBatch", () => {
  let contract: CropBatchMock;

  beforeEach(() => {
    contract = new CropBatchMock();
    contract.reset();
  });

  it("creates a batch successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.blockHeight = 100;
    const result = contract.createBatch(
      "Origin1",
      "ipfs123",
      "Wheat",
      50,
      150,
      1000,
      "FarmA",
      "Organic",
      "High",
      true,
      false,
      "STX"
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);

    const batch = contract.getBatch(0);
    expect(batch?.origin).toBe("Origin1");
    expect(batch?.ipfsHash).toBe("ipfs123");
    expect(batch?.cropType).toBe("Wheat");
    expect(batch?.plantingDate).toBe(50);
    expect(batch?.harvestDate).toBe(150);
    expect(batch?.quantity).toBe(1000);
    expect(batch?.location).toBe("FarmA");
    expect(batch?.certification).toBe("Organic");
    expect(batch?.soilQuality).toBe("High");
    expect(batch?.pesticideUse).toBe(true);
    expect(batch?.fertilizerUse).toBe(false);
    expect(batch?.currency).toBe("STX");
    expect(contract.stxTransfers).toEqual([{ amount: 500, from: "ST1TEST", to: "ST2TEST" }]);
  });

  it("rejects duplicate batch origins", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.blockHeight = 100;
    contract.createBatch(
      "Origin1",
      "ipfs123",
      "Wheat",
      50,
      150,
      1000,
      "FarmA",
      "Organic",
      "High",
      true,
      false,
      "STX"
    );
    const result = contract.createBatch(
      "Origin1",
      "ipfs456",
      "Corn",
      60,
      160,
      2000,
      "FarmB",
      "GMO",
      "Medium",
      false,
      true,
      "USD"
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_BATCH_ALREADY_EXISTS);
  });

  it("rejects non-authorized caller", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.caller = "ST2FAKE";
    contract.authorities = new Set();
    contract.blockHeight = 100;
    const result = contract.createBatch(
      "Origin2",
      "ipfs123",
      "Wheat",
      50,
      150,
      1000,
      "FarmA",
      "Organic",
      "High",
      true,
      false,
      "STX"
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("rejects batch creation without authority contract", () => {
    contract.blockHeight = 100;
    const result = contract.createBatch(
      "NoAuth",
      "ipfs123",
      "Wheat",
      50,
      150,
      1000,
      "FarmA",
      "Organic",
      "High",
      true,
      false,
      "STX"
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_AUTHORITY_NOT_VERIFIED);
  });

  it("rejects invalid quantity", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.blockHeight = 100;
    const result = contract.createBatch(
      "InvalidQty",
      "ipfs123",
      "Wheat",
      50,
      150,
      0,
      "FarmA",
      "Organic",
      "High",
      true,
      false,
      "STX"
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_QUANTITY);
  });

  it("rejects invalid planting date", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.blockHeight = 100;
    const result = contract.createBatch(
      "InvalidPlant",
      "ipfs123",
      "Wheat",
      150,
      200,
      1000,
      "FarmA",
      "Organic",
      "High",
      true,
      false,
      "STX"
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_PLANTING_DATE);
  });

  it("updates a batch successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.blockHeight = 100;
    contract.createBatch(
      "OldOrigin",
      "ipfs123",
      "Wheat",
      50,
      150,
      1000,
      "FarmA",
      "Organic",
      "High",
      true,
      false,
      "STX"
    );
    contract.blockHeight = 110;
    const result = contract.updateBatch(0, "NewOrigin", 1500);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const batch = contract.getBatch(0);
    expect(batch?.origin).toBe("NewOrigin");
    expect(batch?.quantity).toBe(1500);
    const update = contract.state.batchUpdates.get(0);
    expect(update?.updateOrigin).toBe("NewOrigin");
    expect(update?.updateQuantity).toBe(1500);
    expect(update?.updater).toBe("ST1TEST");
  });

  it("rejects update for non-existent batch", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.updateBatch(99, "NewOrigin", 1500);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_BATCH_NOT_FOUND);
  });

  it("rejects update by non-farmer", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.blockHeight = 100;
    contract.createBatch(
      "TestOrigin",
      "ipfs123",
      "Wheat",
      50,
      150,
      1000,
      "FarmA",
      "Organic",
      "High",
      true,
      false,
      "STX"
    );
    contract.caller = "ST3FAKE";
    const result = contract.updateBatch(0, "NewOrigin", 1500);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("sets creation fee successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.setCreationFee(1000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.creationFee).toBe(1000);
    contract.blockHeight = 100;
    contract.createBatch(
      "TestOrigin",
      "ipfs123",
      "Wheat",
      50,
      150,
      1000,
      "FarmA",
      "Organic",
      "High",
      true,
      false,
      "STX"
    );
    expect(contract.stxTransfers).toEqual([{ amount: 1000, from: "ST1TEST", to: "ST2TEST" }]);
  });

  it("rejects creation fee change without authority contract", () => {
    const result = contract.setCreationFee(1000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_AUTHORITY_NOT_VERIFIED);
  });

  it("returns correct batch count", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.blockHeight = 100;
    contract.createBatch(
      "Origin1",
      "ipfs123",
      "Wheat",
      50,
      150,
      1000,
      "FarmA",
      "Organic",
      "High",
      true,
      false,
      "STX"
    );
    contract.createBatch(
      "Origin2",
      "ipfs456",
      "Corn",
      60,
      160,
      2000,
      "FarmB",
      "GMO",
      "Medium",
      false,
      true,
      "USD"
    );
    const result = contract.getBatchCount();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(2);
  });

  it("checks batch existence correctly", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.blockHeight = 100;
    contract.createBatch(
      "TestOrigin",
      "ipfs123",
      "Wheat",
      50,
      150,
      1000,
      "FarmA",
      "Organic",
      "High",
      true,
      false,
      "STX"
    );
    const result = contract.checkBatchExistence("TestOrigin");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const result2 = contract.checkBatchExistence("NonExistent");
    expect(result2.ok).toBe(true);
    expect(result2.value).toBe(false);
  });

  it("parses batch parameters with Clarity types", () => {
    const origin = stringUtf8CV("TestOrigin");
    const quantity = uintCV(1000);
    const ipfs = stringAsciiCV("ipfs123");
    const pesticide = boolCV(true);
    expect(origin.value).toBe("TestOrigin");
    expect(quantity.value).toEqual(BigInt(1000));
    expect(ipfs.value).toBe("ipfs123");
    expect(pesticide.type).toBe(ClarityType.BoolTrue);
  });

  it("rejects batch creation with empty origin", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.blockHeight = 100;
    const result = contract.createBatch(
      "",
      "ipfs123",
      "Wheat",
      50,
      150,
      1000,
      "FarmA",
      "Organic",
      "High",
      true,
      false,
      "STX"
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_ORIGIN);
  });

  it("rejects batch creation with max batches exceeded", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.blockHeight = 100;
    contract.state.maxBatches = 1;
    contract.createBatch(
      "Origin1",
      "ipfs123",
      "Wheat",
      50,
      150,
      1000,
      "FarmA",
      "Organic",
      "High",
      true,
      false,
      "STX"
    );
    const result = contract.createBatch(
      "Origin2",
      "ipfs456",
      "Corn",
      60,
      160,
      2000,
      "FarmB",
      "GMO",
      "Medium",
      false,
      true,
      "USD"
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_BATCHES_EXCEEDED);
  });

  it("sets authority contract successfully", () => {
    const result = contract.setAuthorityContract("ST2TEST");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.authorityContract).toBe("ST2TEST");
  });

  it("rejects invalid authority contract", () => {
    const result = contract.setAuthorityContract("SP000000000000000000002Q6VF78");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });
});