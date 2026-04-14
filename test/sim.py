"""
Modbus TCP simulator — acts as a field device for the Replicator test.

Holding registers 0–9 (unit 1) are pre-loaded with known values:
  address 0 = 10, address 1 = 20, ..., address 9 = 100

The Replicator polls these values and writes them to MMA.
The verify script reads MMA and checks that the values arrived.
"""

from pymodbus.server import StartTcpServer
from pymodbus.datastore import (
    ModbusDeviceContext,
    ModbusServerContext,
    ModbusSequentialDataBlock,
)

REGISTER_VALUES = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]

hr = ModbusSequentialDataBlock(0, REGISTER_VALUES)
store = ModbusDeviceContext(hr=hr)
context = ModbusServerContext(devices=store, single=True)

print(f"[sim] Modbus TCP server listening on 0.0.0.0:502")
print(f"[sim] Holding registers 0-9: {REGISTER_VALUES}")

StartTcpServer(context=context, address=("0.0.0.0", 502))
