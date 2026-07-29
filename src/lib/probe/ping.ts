import { execFile } from "node:child_process";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { applyDegraded } from "./assertions";
import { type ProbeResult, type ProbeSpec, truncateError } from "./types";

const exec = promisify(execFile);

/**
 * Hostnames and IP literals only.
 *
 * The host is passed to `ping` via execFile, which never invokes a shell, so
 * shell metacharacters are inert here. This check is a second line of defence:
 * it stops a stray value from being interpreted as a `ping` *flag* (a target
 * beginning with `-`), and it fails fast with a clear message rather than
 * spawning a process that cannot succeed.
 */
const HOST_PATTERN = /^[a-zA-Z0-9]([a-zA-Z0-9._:-]{0,253}[a-zA-Z0-9])?$/;

/** Both variants of the RTT line: iputils `time=12.3 ms`, busybox `time=12.3`. */
const RTT_PATTERN = /time[=<]\s*([\d.]+)\s*ms/i;

function buildArgs(host: string, timeoutMs: number): string[] {
  const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  // The per-packet wait flag is spelled differently across implementations, and
  // getting it wrong means the probe hangs for the OS default instead of the
  // configured timeout.
  //   macOS/BSD   -W takes milliseconds
  //   iputils     -W takes seconds
  //   busybox     -W takes seconds
  if (process.platform === "darwin") {
    return ["-c", "1", "-W", String(timeoutMs), "-t", String(seconds), host];
  }
  if (process.platform === "win32") {
    return ["-n", "1", "-w", String(timeoutMs), host];
  }
  return ["-c", "1", "-W", String(seconds), host];
}

/**
 * ICMP echo probe, delegated to the system `ping` binary.
 *
 * Raw ICMP sockets require CAP_NET_RAW, which a well-behaved container should not
 * hold. The setuid system binary already has the privilege, so shelling out is
 * the option that does not ask the operator to run Watchman as root. If `ping` is
 * unavailable the error says so explicitly and points at the TCP probe, since a
 * silent permanent failure would look like a real outage.
 */
export async function probePing(spec: ProbeSpec): Promise<ProbeResult> {
  const host = spec.target.trim().replace(/^\w+:\/\//, "").split("/")[0] ?? "";

  if (!HOST_PATTERN.test(host)) {
    return {
      ok: false,
      status: "down",
      latencyMs: null,
      error: `Invalid hostname: ${spec.target}`,
    };
  }

  const timeoutMs = spec.timeoutMs ?? 10_000;
  const start = performance.now();

  try {
    const { stdout } = await exec("ping", buildArgs(host, timeoutMs), {
      timeout: timeoutMs + 1_000,
      windowsHide: true,
      encoding: "utf8",
    });

    const wall = Math.round(performance.now() - start);
    const match = RTT_PATTERN.exec(stdout);
    // Prefer ping's own RTT — it excludes process spawn overhead, which can be
    // several milliseconds and would otherwise pollute a sub-millisecond LAN RTT.
    const latencyMs = match ? Math.round(Number(match[1]) * 100) / 100 : wall;

    // Some implementations exit 0 while reporting 100% loss.
    if (/100(\.0)?% packet loss/i.test(stdout)) {
      return {
        ok: false,
        status: "down",
        latencyMs: null,
        error: `No reply from ${host} (100% packet loss)`,
        meta: { host },
      };
    }

    return {
      ok: true,
      status: applyDegraded(latencyMs, spec.degradedMs),
      latencyMs,
      error: null,
      meta: { host, rttMs: latencyMs, spawnOverheadMs: wall - latencyMs },
    };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; killed?: boolean };

    if (e.code === "ENOENT") {
      return {
        ok: false,
        status: "down",
        latencyMs: null,
        error:
          "`ping` is not available in this environment — use a TCP monitor instead",
        meta: { host },
      };
    }

    if (e.killed) {
      return {
        ok: false,
        status: "down",
        latencyMs: null,
        error: `No reply from ${host} within ${timeoutMs}ms`,
        meta: { host },
      };
    }

    // A non-zero exit is the normal way ping reports unreachability.
    const out = e.stdout ?? "";
    if (/unknown host|cannot resolve|Name or service not known/i.test(out)) {
      return {
        ok: false,
        status: "down",
        latencyMs: null,
        error: `DNS lookup failed — ${host} not found`,
        meta: { host },
      };
    }

    return {
      ok: false,
      status: "down",
      latencyMs: null,
      error: truncateError(
        out.trim().split("\n").pop() || `No reply from ${host}`,
      ),
      meta: { host },
    };
  }
}
