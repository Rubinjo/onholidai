"""Read-only clock diagnostic. Run from the repo root with Node 24 in PATH."""

import json
import os
import base64
import subprocess
import time
from collections import Counter
from uuid import uuid4

from onholidai_agent.api.security import (
    ServiceTokenContext,
    create_service_token,
    verify_service_token,
)

program = """
import { createInterface } from 'node:readline';
import { createServiceToken, verifyServiceToken } from './web/server/agent-client/credentials.ts';
createInterface({ input: process.stdin }).on('line', line => {
  const token = JSON.parse(line);
  if (typeof token === 'object') {
    const signed = createServiceToken({ ...token, secret: 'local-clock-diagnostic-secret-00000000', audience: 'agent', scopes: ['trip:read'], issuedAt: Math.floor(Date.now()/1000) - Number(process.env.CLOCK_BACKDATE ?? 0) });
    process.stdout.write(JSON.stringify({ token: signed }) + '\\n'); return;
  }
  const c = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
  let result = 'valid';
  try { verifyServiceToken(token, { secret: 'local-clock-diagnostic-secret-00000000', expectedAudience: 'web', expectedContext: c, requiredScopes: ['run:write'] }); }
  catch (error) { result = error.message; }
  process.stdout.write(JSON.stringify({ result, delta: c.iat - Math.floor(Date.now()/1000) }) + '\\n');
});
"""
node = os.environ.get("NODE_BINARY", "node")
process = subprocess.Popen(
    [str(node), "--experimental-strip-types", "--input-type=module", "-e", program],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    text=True,
    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
)
assert process.stdin and process.stdout
outcomes = Counter()
reverse = os.environ.get("CLOCK_DIRECTION") == "node-python"
for _ in range(10000):
    context = ServiceTokenContext(str(uuid4()), str(uuid4()), str(uuid4()), 1)
    message = (
        {
            "userId": context.user_id,
            "tripId": context.trip_id,
            "requestId": context.request_id,
            "baseTripVersion": 1,
        }
        if reverse
        else create_service_token(
            secret="local-clock-diagnostic-secret-00000000",
            audience="web",
            context=context,
            scopes=["run:write"],
            issued_at=int(time.time()) - 1,
        )
    )
    process.stdin.write(json.dumps(message) + "\n")
    process.stdin.flush()
    result = json.loads(process.stdout.readline())
    if reverse:
        token = result["token"]
        status = "valid"
        try:
            verify_service_token(
                token,
                secret="local-clock-diagnostic-secret-00000000",
                expected_audience="agent",
                expected_context=context,
                required_scopes=["trip:read"],
            )
        except ValueError as error:
            status = str(error)
        payload = token.split(".")[1]
        issued = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))["iat"]
        result = {"result": status, "delta": issued - int(time.time())}
    outcomes[(result["result"], result["delta"])] += 1
process.stdin.close()
process.wait(timeout=5)
print(
    json.dumps(
        [
            {"result": result, "secondDelta": delta, "samples": count}
            for (result, delta), count in outcomes.items()
        ]
    )
)
