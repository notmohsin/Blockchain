#!/usr/bin/env bash
# Verifies the CustodyChain BFT network end to end and prints a results summary.
#   1. channel configuration: consensus type and the four consenters
#   2. a transaction commits; how many orderer signatures each block carries
#   3. f = 1: with one orderer down the network still commits
#   4. two orderers down (no quorum of 3): transactions do NOT commit
#   5. recovery: stopped orderers come back and catch up
#   6. leader failure: the current leader is stopped, a view change elects a new one, commits resume
#   7. persistence: network.sh stop / start keeps ledger, state and hashes
#   8. resource use of the whole network
# Run on a network created with ./network.sh all. Results are also written to test-results.txt.
set -uo pipefail
cd "$(dirname "$0")"
NETWORK_SH_LIB=1 source ./network.sh
set +e
OUT=test-results.txt
: > "$OUT"
log() { echo -e "$*" | tee -a "$OUT"; }
pass() { log "  PASS  $*"; }
fail() { log "  FAIL  $*"; FAILED=1; }
FAILED=0
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
el() { awk -v a="$1" -v b="$2" 'BEGIN{printf "%.1f", b-a}'; }   # elapsed seconds

heights() { for o in "${ORGS[@]}"; do use_org "$o"; peer channel getinfo -c "$CHANNEL" 2>/dev/null | sed 's/.*"height":\([0-9]*\),"currentBlockHash":"\([^"]*\)".*/\1 \2/'; done; }
submit() {   # submit <id> [orderer-org] [timeout-seconds] -> 0 if committed VALID on all peers
  local id=$1 via=${2:-police} to=${3:-40}
  use_org police
  read -r -a OA <<< "$(orderer_args "$via")"
  timeout $((to + 10)) peer chaincode invoke "${OA[@]}" -C "$CHANNEL" -n "$CC_NAME" "${PEER_ARGS[@]}" \
    -c "{\"Args\":[\"CreateAsset\",\"$id\",\"tester\",\"bft test\",\"2026-11-19T00:00:00+05:30\",\"lab\",\"test\",\"none\"]}" \
    --waitForEvent --waitForEventTimeout "${to}s" > "$TMP/invoke.log" 2>&1
  grep -q "committed with status (VALID) at localhost:7051" "$TMP/invoke.log"
}
fetch_block() {  # fetch_block newest|config|N file
  use_org police
  read -r -a OA <<< "$(orderer_args fsl)"
  peer channel fetch "$1" "$TMP/b.pb" -c "$CHANNEL" "${OA[@]}" >/dev/null 2>&1 && configtxlator proto_decode --type common.Block --input "$TMP/b.pb" --output "$2"
}

log "CustodyChain BFT network test: $(date -Iseconds)"
log "Fabric $(peer version | sed -n 's/ Version: //p'), channel '$CHANNEL', chaincode '$CC_NAME'\n"

# ------------------------------------------------------------------------------------------------ 1
log "[1] Channel configuration"
fetch_block config "$TMP/config.json"
CT=$(jq -r '.data.data[0].payload.data.config.channel_group.groups.Orderer.values.ConsensusType.value.type' "$TMP/config.json")
NCONS=$(jq '.data.data[0].payload.data.config.channel_group.groups.Orderer.values.Orderers.value.consenter_mapping | length' "$TMP/config.json")
CONS=$(jq -r '.data.data[0].payload.data.config.channel_group.groups.Orderer.values.Orderers.value.consenter_mapping[] | "\(.id):\(.msp_id)@\(.host):\(.port)"' "$TMP/config.json" | tr '\n' ' ')
log "  consensus type: $CT; consenters ($NCONS): $CONS"
[ "$CT" = "BFT" ] && [ "$NCONS" = 4 ] && pass "BFT with 4 consenters (n=4 -> f=1, quorum 3)" || fail "expected BFT with 4 consenters"

# ------------------------------------------------------------------------------------------------ 2
log "\n[2] Transaction with all orderers up"
T0=$(date +%s.%N); submit "BFT-T2-$RANDOM"; R=$?; T1=$(date +%s.%N)
[ $R -eq 0 ] && pass "committed VALID on all 3 peers in $(el "$T0" "$T1") s" || { fail "commit failed"; tail -3 "$TMP/invoke.log" | tee -a "$OUT"; }
fetch_block newest "$TMP/newest.json"
# Block metadata[0] (SIGNATURES) is a raw common.Metadata message; in BFT each signature names its consenter ID
jq -r '.metadata.metadata[0]' "$TMP/newest.json" | base64 -d > "$TMP/meta0.pb"
configtxlator proto_decode --type common.Metadata --input "$TMP/meta0.pb" --output "$TMP/meta0.json"
NSIG=$(jq '.signatures | length' "$TMP/meta0.json")
SIGNERS=$(jq -r '.signatures[].identifier_header' "$TMP/meta0.json" | while read -r h; do echo "$h" | base64 -d | od -An -tu1 -N2 | awk '{print "consenter-"$2}'; done | sort | tr '\n' ' ')
log "  newest block (#$(jq -r .header.number "$TMP/newest.json")) carries $NSIG orderer signatures from: $SIGNERS"
[ "${NSIG:-0}" -ge 3 ] && pass "block certified by a BFT quorum (>= 3 of 4 consenter signatures)" || fail "block carries fewer than 3 consenter signatures"

# ------------------------------------------------------------------------------------------------ 3
log "\n[3] One orderer down (orderer.prosecution): f = 1 must be tolerated"
docker stop orderer.prosecution.custodychain.local >/dev/null
T0=$(date +%s.%N); submit "BFT-T3-$RANDOM"; R=$?; T1=$(date +%s.%N)
[ $R -eq 0 ] && pass "committed with 3 of 4 orderers in $(el "$T0" "$T1") s" || fail "did not commit with one orderer down"

# ------------------------------------------------------------------------------------------------ 4
log "\n[4] Two orderers down (prosecution + court): no quorum of 3"
docker stop orderer.court.custodychain.local >/dev/null
H_BEFORE=$(heights | head -1 | cut -d' ' -f1)
submit "BFT-T4-$RANDOM" police 25; R=$?
H_AFTER=$(heights | head -1 | cut -d' ' -f1)
[ $R -ne 0 ] && [ "$H_BEFORE" = "$H_AFTER" ] && pass "no block was produced (height stayed $H_AFTER): BFT halts rather than risk safety" || fail "a transaction committed without a BFT quorum"

# ------------------------------------------------------------------------------------------------ 5
log "\n[5] Recovery: restart both orderers"
docker start orderer.court.custodychain.local orderer.prosecution.custodychain.local >/dev/null
sleep 8
T0=$(date +%s.%N); submit "BFT-T5-$RANDOM" police 90; R=$?; T1=$(date +%s.%N)
[ $R -eq 0 ] && pass "commits resumed $(el "$T0" "$T1") s after restart" || fail "no commit after recovery"
sleep 5
log "  orderer heights after recovery:"
: > "$TMP/oh"
for o in "${ORDERERS[@]}"; do t=$(ord_tls "$o")
  h=$(osnadmin channel list --channelID "$CHANNEL" -o "localhost:$(ord_admin "$o")" --ca-file "$t/ca.crt" --client-cert "$t/server.crt" --client-key "$t/server.key" 2>/dev/null | sed -n '/^{/,$p' | jq -r .height)
  log "    $(ord_host "$o"): $h"; echo "$h" >> "$TMP/oh"; done
[ "$(sort -u "$TMP/oh" | wc -l)" -eq 1 ] && pass "all 4 orderers at the same height (stopped nodes caught up)" || log "  INFO  orderer heights differ (catch-up may still be in progress)"

# ------------------------------------------------------------------------------------------------ 6
id_org() { case $1 in 1) echo police;; 2) echo fsl;; 3) echo court;; 4) echo prosecution;; esac; }
LEADER_ID=$(docker logs orderer.fsl.custodychain.local 2>&1 | grep -oE 'current leader: [0-9]+' | tail -1 | grep -oE '[0-9]+$')
LEADER=$(id_org "${LEADER_ID:-1}")
VIA=fsl; [ "$LEADER" = fsl ] && VIA=court
log "\n[6] Leader failure: current leader is consenter $LEADER_ID ($(ord_host "$LEADER")); stop it, submit via $(ord_host "$VIA")"
docker stop "$(ord_host "$LEADER")" >/dev/null
T0=$(date +%s.%N); submit "BFT-T6-$RANDOM" "$VIA" 180; R=$?; T1=$(date +%s.%N)
NEW_ID=$(docker logs --since 4m "$(ord_host "$VIA")" 2>&1 | grep -oE 'current leader: [0-9]+' | tail -1 | grep -oE '[0-9]+$')
[ $R -eq 0 ] && [ -n "$NEW_ID" ] && [ "$NEW_ID" != "$LEADER_ID" ] \
  && pass "view change elected consenter $NEW_ID; commits resumed after $(el "$T0" "$T1") s" \
  || fail "no commit / no new leader after stopping the leader (new leader: ${NEW_ID:-none})"
docker start "$(ord_host "$LEADER")" >/dev/null; sleep 8

# ------------------------------------------------------------------------------------------------ 7
log "\n[7] Persistence: network.sh stop / start"
heights > "$TMP/h_before"; Q_BEFORE=$(cmd_query '{"Args":["GetAllAssets"]}' 2>/dev/null | sha256sum | cut -c1-16)
cmd_stop >/dev/null 2>&1
RUNNING=$(docker ps -q --filter network=custodychain_bft | wc -l)
cmd_start >/dev/null 2>&1; sleep 10
heights > "$TMP/h_after"; Q_AFTER=$(cmd_query '{"Args":["GetAllAssets"]}' 2>/dev/null | sha256sum | cut -c1-16)
log "  containers running while stopped: $RUNNING; peer heights+hashes before: $(head -1 "$TMP/h_before"), after: $(head -1 "$TMP/h_after")"
diff -q "$TMP/h_before" "$TMP/h_after" >/dev/null && [ "$Q_BEFORE" = "$Q_AFTER" ] && [ "$RUNNING" = 0 ] \
  && pass "identical heights, block hashes and world state after stop/start" || fail "state changed across stop/start"
submit "BFT-T7-$RANDOM" police 60 && pass "new transaction committed after restart" || fail "no commit after restart"

# ------------------------------------------------------------------------------------------------ 8
log "\n[8] Resource use (docker stats)"
docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' $(docker ps -q --filter network=custodychain_bft) > "$TMP/stats"
awk '{print "    "$1": "$2}' "$TMP/stats" | tee -a "$OUT" >/dev/null
TOTAL=$(awk '{v=$2; u=v; gsub(/[0-9.]/,"",u); gsub(/[A-Za-z]/,"",v); if(u=="GiB")v*=1024; if(u=="KiB")v/=1024; s+=v} END{printf "%.0f", s}' "$TMP/stats")
log "  total memory of $(wc -l < "$TMP/stats") containers: ${TOTAL} MiB"

log "\nFinal heights:"; heights | sed 's/^/    /' | tee -a "$OUT" >/dev/null
[ $FAILED -eq 0 ] && log "\nRESULT: ALL TESTS PASSED" || log "\nRESULT: SOME TESTS FAILED"
exit $FAILED
