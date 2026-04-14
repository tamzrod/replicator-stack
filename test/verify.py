"""
Verify that the Replicator has written data from the simulator into MMA.

Reads holding registers 0–9 from MMA unit 1 via Modbus TCP and checks that
they match the values the simulator is serving.

Retries for up to ~30 seconds to allow time for MMA startup and at least one
full Replicator poll cycle.
"""

import sys
import time

from pymodbus.client import ModbusTcpClient

MMA_HOST = "mma"
MMA_PORT = 502
UNIT = 1
ADDRESS = 0
COUNT = 10

EXPECTED = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]

MAX_ATTEMPTS = 15
RETRY_DELAY = 2  # seconds

print(f"[verify] Checking MMA {MMA_HOST}:{MMA_PORT} unit={UNIT} "
      f"HR[{ADDRESS}:{ADDRESS+COUNT}]")
print(f"[verify] Expected: {EXPECTED}")

for attempt in range(1, MAX_ATTEMPTS + 1):
    print(f"[verify] Attempt {attempt}/{MAX_ATTEMPTS}...", flush=True)
    try:
        client = ModbusTcpClient(MMA_HOST, port=MMA_PORT)
        if client.connect():
            try:
                result = client.read_holding_registers(ADDRESS, COUNT, slave=UNIT)
            finally:
                client.close()
            if result.isError():
                print(f"[verify] Modbus error: {result}")
            else:
                registers = list(result.registers)
                print(f"[verify] Got: {registers}")
                if registers == EXPECTED:
                    print("[verify] PASS — registers match expected values")
                    sys.exit(0)
                else:
                    print(f"[verify] Mismatch — retrying in {RETRY_DELAY}s")
        else:
            print(f"[verify] Could not connect to MMA — retrying in {RETRY_DELAY}s")
    except Exception as e:
        print(f"[verify] Error: {e} — retrying in {RETRY_DELAY}s")

    time.sleep(RETRY_DELAY)

print("[verify] FAIL — registers did not match expected values after all attempts")
sys.exit(1)
