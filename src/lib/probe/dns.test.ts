import { describe, expect, it } from "vitest";
import {
  evaluateDnsAnswer,
  formatRecords,
  normalizeRecord,
  parseExpectedRecords,
} from "./dns";

describe("normalizeRecord", () => {
  it("treats the root's trailing dot and case as insignificant, because DNS does", () => {
    expect(normalizeRecord("Example.COM.")).toBe("example.com");
    expect(normalizeRecord("  example.com  ")).toBe("example.com");
  });
});

describe("formatRecords", () => {
  it("passes address records through unchanged", () => {
    expect(formatRecords("A", ["93.184.216.34", "93.184.216.35"])).toEqual([
      "93.184.216.34",
      "93.184.216.35",
    ]);
  });

  it("reassembles TXT chunks, which a resolver splits at 255 bytes", () => {
    // A DKIM key arrives split; comparing against the published value requires
    // joining the parts back with no separator.
    expect(formatRecords("TXT", [["v=DKIM1; k=rsa; ", "p=MIGfMA0GCS"]])).toEqual([
      "v=DKIM1; k=rsa; p=MIGfMA0GCS",
    ]);
  });

  it("renders MX as priority and exchange, the way a zone file writes it", () => {
    expect(
      formatRecords("MX", [
        { priority: 10, exchange: "mail1.example.com" },
        { priority: 20, exchange: "mail2.example.com" },
      ]),
    ).toEqual(["10 mail1.example.com", "20 mail2.example.com"]);
  });

  it("renders SRV in priority weight port target order", () => {
    expect(
      formatRecords("SRV", [
        { priority: 10, weight: 5, port: 443, name: "sip.example.com" },
      ]),
    ).toEqual(["10 5 443 sip.example.com"]);
  });

  it("names the CAA property rather than the literal record type", () => {
    // The shape node actually returns carries a `type` key alongside the tag —
    // an object written from the docs alone would not, and would let a bug that
    // renders every CAA record as "type CAA" through.
    expect(
      formatRecords("CAA", [
        { critical: 0, type: "CAA", issue: "letsencrypt.org" },
        { critical: 0, type: "CAA", issuewild: "pki.goog" },
      ]),
    ).toEqual(["issue letsencrypt.org", "issuewild pki.goog"]);
  });

  it("flattens SOA, which node returns as a lone object rather than an array", () => {
    expect(
      formatRecords("SOA", {
        nsname: "ns1.example.com",
        hostmaster: "admin.example.com",
        serial: 2026080301,
      }),
    ).toEqual(["ns1.example.com admin.example.com 2026080301"]);
  });

  it("returns nothing for an empty or absent answer", () => {
    expect(formatRecords("A", [])).toEqual([]);
    expect(formatRecords("A", null)).toEqual([]);
    expect(formatRecords("SOA", undefined)).toEqual([]);
  });
});

describe("evaluateDnsAnswer", () => {
  it("fails an empty answer", () => {
    const r = evaluateDnsAnswer({ records: [], expected: [] });
    expect(r.pass).toBe(false);
    expect(r.error).toBe("No records returned");
  });

  it("passes with no expectation, since resolving at all is the assertion", () => {
    expect(
      evaluateDnsAnswer({ records: ["93.184.216.34"], expected: [] }).pass,
    ).toBe(true);
  });

  it("passes when every expected record is present, ignoring extras", () => {
    expect(
      evaluateDnsAnswer({
        records: ["93.184.216.34", "93.184.216.35"],
        expected: ["93.184.216.34"],
      }).pass,
    ).toBe(true);
  });

  it("names what is missing, and what it got instead", () => {
    const r = evaluateDnsAnswer({
      records: ["93.184.216.99"],
      expected: ["93.184.216.34"],
    });

    expect(r.pass).toBe(false);
    expect(r.error).toContain("93.184.216.34");
    expect(r.error).toContain("93.184.216.99");
  });

  it("compares case- and trailing-dot-insensitively", () => {
    expect(
      evaluateDnsAnswer({
        records: ["Mail.Example.COM."],
        expected: ["mail.example.com"],
      }).pass,
    ).toBe(true);
  });

  it("in exact mode, an extra record is a failure — that is the point of the mode", () => {
    const r = evaluateDnsAnswer({
      records: ["93.184.216.34", "10.0.0.1"],
      expected: ["93.184.216.34"],
      mode: "exact",
    });

    expect(r.pass).toBe(false);
    expect(r.error).toContain("unexpected 10.0.0.1");
  });

  it("in exact mode, reports missing and unexpected together", () => {
    const r = evaluateDnsAnswer({
      records: ["10.0.0.1"],
      expected: ["93.184.216.34"],
      mode: "exact",
    });

    expect(r.error).toContain("missing 93.184.216.34");
    expect(r.error).toContain("unexpected 10.0.0.1");
  });

  it("in exact mode, order does not matter — a record set is unordered", () => {
    expect(
      evaluateDnsAnswer({
        records: ["b.example.com", "a.example.com"],
        expected: ["a.example.com", "b.example.com"],
        mode: "exact",
      }).pass,
    ).toBe(true);
  });
});

describe("parseExpectedRecords", () => {
  it("accepts newlines, commas, or both", () => {
    expect(parseExpectedRecords("a.example.com\nb.example.com, c.example.com")).toEqual(
      ["a.example.com", "b.example.com", "c.example.com"],
    );
  });

  it("treats empty and absent input as no expectation", () => {
    expect(parseExpectedRecords("")).toEqual([]);
    expect(parseExpectedRecords(null)).toEqual([]);
    expect(parseExpectedRecords("  \n , ")).toEqual([]);
  });
});
