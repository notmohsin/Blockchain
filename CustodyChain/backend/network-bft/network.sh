#!/usr/bin/env bash
# CustodyChain BFT test network (Hyperledger Fabric v3.1.5)
#   4 BFT consenters: Police, FSL, Court, Prosecution  (n = 4, f = 1, quorum = 3)
#   3 peers:          Police, FSL, Court               (chaincode endorsement: MAJORITY = 2 of 3)
#
# Usage: ./network.sh <command>
#   up          generate identities (first run only) and start all containers
#   channel     create channel '$CHANNEL' and join all orderers and peers
#   deploy      build and deploy the authors' chaincode (../chaincode) as 'custody' on all peers
#   deploy-v2   build and deploy the v2 evidence-registry chaincode (../chaincode-v2) as 'evidence'
#   users       enrol the role users (io.sharma, malkhana.desai, examiner.mehta, clerk.rao) via the agency CAs
#   all         up + channel + deploy + deploy-v2 + users
#   status      containers, per-orderer channel height, per-peer ledger height
#   invoke ARGS submit a transaction, e.g. ./network.sh invoke '{"Args":["CreateAsset","E1","w","x","y","z","a","b"]}'
#   query  ARGS evaluate on the Police peer, e.g. ./network.sh query '{"Args":["GetAllAssets"]}'
#   stop        stop all containers, KEEPING ledgers, state and identities
#   start       resume a stopped network from persisted state
#   down        WIPE: delete containers, ledger volumes, identities and channel artefacts
set -euo pipefail
cd "$(dirname "$0")"

export PATH="$PWD/../bin/v3.1.5:$PWD/../bin:$PATH"   # v3.1.5 first; ../bin supplies fabric-ca-client 1.5
export FABRIC_CFG_PATH="$PWD/config"          # core.yaml for the peer CLI
export FABRIC_LOGGING_SPEC=${FABRIC_LOGGING_SPEC:-grpc=error:info}
CHANNEL=${CHANNEL:-custody}
CC_NAME=${CC_NAME:-custody}
CC_VERSION=${CC_VERSION:-1.0}
CC_SEQUENCE=${CC_SEQUENCE:-1}
CC_SRC=${CC_SRC:-../chaincode}
COMPOSE="docker compose -f compose.yaml"
ORGS=(police fsl court)
ORDERERS=(police fsl court prosecution)

C_G='\033[0;32m'; C_Y='\033[1;33m'; C_R='\033[0;31m'; C_B='\033[0;34m'; C_0='\033[0m'
info() { echo -e "${C_B}$*${C_0}"; }
ok()   { echo -e "${C_G}$*${C_0}"; }
warn() { echo -e "${C_Y}$*${C_0}"; }
die()  { echo -e "${C_R}$*${C_0}" >&2; exit 1; }

ORG_DIR="$PWD/organizations"
ord_port()   { case $1 in police) echo 7050;; fsl) echo 8050;; court) echo 11050;; prosecution) echo 10050;; esac; }
ord_admin()  { case $1 in police) echo 7053;; fsl) echo 8053;; court) echo 11053;; prosecution) echo 10053;; esac; }
ord_host()   { echo "orderer.$1.custodychain.local"; }
ord_tls()    { echo "$ORG_DIR/ordererOrganizations/$1.custodychain.local/orderers/$(ord_host "$1")/tls"; }
ord_tlsca()  { echo "$ORG_DIR/ordererOrganizations/$1.custodychain.local/tlsca/tlsca.$1.custodychain.local-cert.pem"; }
peer_port()  { case $1 in police) echo 7051;; fsl) echo 8051;; court) echo 9051;; esac; }
peer_msp()   { case $1 in police) echo PoliceMSP;; fsl) echo FSLMSP;; court) echo CourtMSP;; esac; }
peer_tlsca() { echo "$ORG_DIR/peerOrganizations/$1.custodychain.local/tlsca/tlsca.$1.custodychain.local-cert.pem"; }

# Point the peer CLI at an organisation's peer, acting as that organisation's admin
use_org() {
  local o=$1
  export CORE_PEER_TLS_ENABLED=true
  export CORE_PEER_LOCALMSPID=$(peer_msp "$o")
  export CORE_PEER_ADDRESS=localhost:$(peer_port "$o")
  export CORE_PEER_TLS_ROOTCERT_FILE=$(peer_tlsca "$o")
  export CORE_PEER_MSPCONFIGPATH=$ORG_DIR/peerOrganizations/$o.custodychain.local/users/Admin@$o.custodychain.local/msp
}
# Orderer endpoint used by the CLI to submit; any consenter works (SmartBFT forwards requests to the leader)
orderer_args() { local o=${1:-police}; echo "-o localhost:$(ord_port "$o") --ordererTLSHostnameOverride $(ord_host "$o") --tls --cafile $(ord_tlsca "$o")"; }
read -r -a ORDERER_ARGS <<< "$(orderer_args "${SUBMIT_VIA:-police}")"
PEER_ARGS=()
for o in "${ORGS[@]}"; do PEER_ARGS+=(--peerAddresses "localhost:$(peer_port "$o")" --tlsRootCertFiles "$(peer_tlsca "$o")"); done

fabric_containers() { docker ps -a ${1:-} --filter label=service=hyperledger-fabric --filter network=custodychain_bft --format '{{.Names}}'; }

# ---------------------------------------------------------------------------------------------------------
cmd_up() {
  command -v cryptogen >/dev/null || die "Fabric 3.1.5 binaries not found in ../bin/v3.1.5"
  if [ ! -d "$ORG_DIR/peerOrganizations" ]; then
    info "Generating identities for 4 orderer organisations and 3 peer organisations (cryptogen)"
    cryptogen generate --config=crypto-config.yaml --output="$ORG_DIR" >/dev/null
    mkdir -p "$ORG_DIR/tlsca"
    for o in "${ORDERERS[@]}"; do cp "$(ord_tlsca "$o")" "$ORG_DIR/tlsca/$o.pem"; done
  else
    info "Identities already exist: reusing them"
  fi
  info "Starting 4 BFT orderers and 3 peers"
  $COMPOSE up -d 2>&1 | grep -v 'level=warning' || true
  sleep 3
  docker ps --filter network=custodychain_bft --format 'table {{.Names}}\t{{.Status}}'
}

cmd_channel() {
  mkdir -p channel-artifacts
  info "Creating genesis block for channel '$CHANNEL' (profile CustodyChainBFT)"
  FABRIC_CFG_PATH="$PWD/configtx" configtxgen -profile CustodyChainBFT -outputBlock "channel-artifacts/$CHANNEL.block" -channelID "$CHANNEL" 2>&1 | tail -1
  for o in "${ORDERERS[@]}"; do
    local t; t=$(ord_tls "$o")
    osnadmin channel join --channelID "$CHANNEL" --config-block "channel-artifacts/$CHANNEL.block" \
      -o "localhost:$(ord_admin "$o")" --ca-file "$t/ca.crt" --client-cert "$t/server.crt" --client-key "$t/server.key" >/dev/null
    ok "  $(ord_host "$o") joined '$CHANNEL'"
  done
  sleep 3
  for o in "${ORGS[@]}"; do
    use_org "$o"
    local n=0
    until peer channel join -b "channel-artifacts/$CHANNEL.block" >/dev/null 2>&1; do
      n=$((n + 1)); [ $n -ge 5 ] && die "peer0.$o could not join '$CHANNEL'"; sleep 2
    done
    ok "  peer0.$o.custodychain.local joined '$CHANNEL'"
  done
}

cmd_deploy() {
  local pkgdir=channel-artifacts/ccpkg label="${CC_NAME}_${CC_VERSION}"
  info "Building chaincode image ${CC_NAME}_ccaas_image from $CC_SRC"
  docker build -q -t "${CC_NAME}_ccaas_image:latest" "$CC_SRC" >/dev/null
  info "Packaging chaincode-as-a-service '$label'"
  rm -rf "$pkgdir" && mkdir -p "$pkgdir/src"
  cat > "$pkgdir/src/connection.json" <<EOF
{"address": "{{.peername}}-${CC_NAME}-cc:9999", "dial_timeout": "10s", "tls_required": false}
EOF
  echo "{\"type\": \"ccaas\", \"label\": \"$label\"}" > "$pkgdir/metadata.json"
  # Deterministic archives (fixed mtime/owner, gzip without timestamp) so the package ID is stable across runs
  local TAR=(tar --sort=name --mtime=2026-01-01T00:00:00Z --owner=0 --group=0 --numeric-owner)
  "${TAR[@]}" -C "$pkgdir/src" -cf - connection.json | gzip -n > "$pkgdir/code.tar.gz"
  "${TAR[@]}" -C "$pkgdir" -cf - metadata.json code.tar.gz | gzip -n > "channel-artifacts/$label.tar.gz"
  local pkgid=""
  for o in "${ORGS[@]}"; do
    use_org "$o"
    peer lifecycle chaincode install "channel-artifacts/$label.tar.gz" >/dev/null 2>&1 || true
    pkgid=$(peer lifecycle chaincode calculatepackageid "channel-artifacts/$label.tar.gz")
    ok "  installed on peer0.$o ($pkgid)"
  done
  use_org police
  if peer lifecycle chaincode querycommitted -C "$CHANNEL" -n "$CC_NAME" 2>/dev/null | grep -q "Sequence: $CC_SEQUENCE,"; then
    ok "  definition sequence $CC_SEQUENCE already committed: skipping approve/commit"
  else
    for o in "${ORGS[@]}"; do
      use_org "$o"
      peer lifecycle chaincode approveformyorg "${ORDERER_ARGS[@]}" --channelID "$CHANNEL" --name "$CC_NAME" \
        --version "$CC_VERSION" --package-id "$pkgid" --sequence "$CC_SEQUENCE" >/dev/null 2>&1 \
        || die "approval by $(peer_msp "$o") failed"
      ok "  approved by $(peer_msp "$o")"
    done
    use_org police
    # Approvals are committed in separate blocks; retry until every peer has seen all of them.
    local n=0 out
    until out=$(peer lifecycle chaincode commit "${ORDERER_ARGS[@]}" --channelID "$CHANNEL" --name "$CC_NAME" \
                  --version "$CC_VERSION" --sequence "$CC_SEQUENCE" "${PEER_ARGS[@]}" 2>&1); do
      n=$((n + 1)); [ $n -ge 6 ] && die "commit failed:\n$out"; sleep 3
    done
    ok "  chaincode definition committed on '$CHANNEL'"
  fi
  # Run the services with the package ID that the channel actually approved (the peer refuses any other)
  use_org police
  local approved
  approved=$(peer lifecycle chaincode queryapproved -C "$CHANNEL" -n "$CC_NAME" --sequence "$CC_SEQUENCE" -O json 2>/dev/null | jq -r '.source.Type.LocalPackage.package_id // empty')
  [ -n "$approved" ] && pkgid=$approved
  [ "$approved" = "$(peer lifecycle chaincode calculatepackageid "channel-artifacts/$label.tar.gz")" ] \
    || warn "  note: approved package ID differs from the freshly built package; using the approved one ($pkgid)"
  for o in "${ORGS[@]}"; do
    docker rm -f "$o-$CC_NAME-cc" >/dev/null 2>&1 || true
    docker run -d --name "$o-$CC_NAME-cc" --network custodychain_bft \
      --label service=hyperledger-fabric --label fabric.role=chaincode \
      -e CHAINCODE_SERVER_ADDRESS=0.0.0.0:9999 -e CHAINCODE_ID="$pkgid" -e CORE_CHAINCODE_ID_NAME="$pkgid" \
      "${CC_NAME}_ccaas_image:latest" >/dev/null
    ok "  chaincode service $o-$CC_NAME-cc started"
  done
}

# ---------------------------------------------------------------------------------------------------------
# M1 / D-035, D-036: users with roles. One Fabric CA per peer agency, started with that agency's existing
# cryptogen CA certificate and key, so enrolled users are trusted by the existing channel MSPs.
CA_ADMIN_PW=${CA_ADMIN_PW:-adminpw}
ca_port() { case $1 in police) echo 7054;; fsl) echo 8054;; court) echo 9054;; esac; }
# org:username:role
USERS=(police:io.sharma:io police:malkhana.desai:malkhana fsl:examiner.mehta:examiner court:clerk.rao:court_clerk)

cmd_users() {
  local secrets="$ORG_DIR/user-enrollment-secrets.txt"
  touch "$secrets"; chmod 600 "$secrets"
  for o in "${ORGS[@]}"; do
    local reg="$ORG_DIR/fabric-ca-client/$o/registrar"
    local n=0
    until curl -sf "http://localhost:$(ca_port "$o")/cainfo" >/dev/null; do n=$((n+1)); [ $n -ge 20 ] && die "ca.$o not reachable"; sleep 1; done
    if [ ! -d "$reg/signcerts" ]; then
      fabric-ca-client enroll -u "http://admin:$CA_ADMIN_PW@localhost:$(ca_port "$o")" --caname "ca-$o" -M "$reg" >/dev/null 2>&1 \
        || die "registrar enrolment at ca.$o failed"
    fi
  done
  for u in "${USERS[@]}"; do
    IFS=: read -r o name role <<< "$u"
    local dom="$o.custodychain.local" msp="$ORG_DIR/peerOrganizations/$o.custodychain.local/users/$name@$o.custodychain.local/msp"
    if [ -f "$msp/signcerts/cert.pem" ]; then ok "  $name@$o (role=$role) already enrolled"; continue; fi
    local secret; secret=$(grep "^$name@$o " "$secrets" | cut -d' ' -f2 || true)
    if [ -z "$secret" ]; then
      secret=$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 20)
      fabric-ca-client register -u "http://localhost:$(ca_port "$o")" --caname "ca-$o" -M "$ORG_DIR/fabric-ca-client/$o/registrar" \
        --id.name "$name" --id.secret "$secret" --id.type client --id.attrs "role=$role:ecert" >/dev/null 2>&1 \
        || die "registering $name at ca.$o failed"
      echo "$name@$o $secret" >> "$secrets"
    fi
    fabric-ca-client enroll -u "http://$name:$secret@localhost:$(ca_port "$o")" --caname "ca-$o" -M "$msp" >/dev/null 2>&1 \
      || die "enrolling $name at ca.$o failed"
    mv "$msp/signcerts/"*.pem "$msp/signcerts/cert.pem" 2>/dev/null || true
    cp "$ORG_DIR/peerOrganizations/$dom/users/User1@$dom/msp/config.yaml" "$msp/config.yaml"
    ok "  enrolled $name@$o with role=$role"
  done
}

cmd_status() {
  docker ps -a --filter network=custodychain_bft --format 'table {{.Names}}\t{{.Status}}'
  echo
  info "Orderer channel heights (osnadmin):"
  for o in "${ORDERERS[@]}"; do
    local t; t=$(ord_tls "$o")
    printf "  %-40s " "$(ord_host "$o")"
    osnadmin channel list --channelID "$CHANNEL" -o "localhost:$(ord_admin "$o")" --ca-file "$t/ca.crt" \
      --client-cert "$t/server.crt" --client-key "$t/server.key" 2>/dev/null | sed -n '/^{/,$p' \
      | jq -r '"\(.consensusRelation) \(.status) height \(.height)"' 2>/dev/null || echo "unreachable"
  done
  info "Peer ledger heights:"
  for o in "${ORGS[@]}"; do
    use_org "$o"
    printf "  %-40s %s\n" "peer0.$o.custodychain.local" "$(peer channel getinfo -c "$CHANNEL" 2>/dev/null | sed 's/Blockchain info: //' || echo unreachable)"
  done
}

cmd_invoke() {
  use_org police
  peer chaincode invoke "${ORDERER_ARGS[@]}" -C "$CHANNEL" -n "$CC_NAME" "${PEER_ARGS[@]}" -c "$1" --waitForEvent --waitForEventTimeout 60s
}

cmd_query() { use_org police; peer chaincode query -C "$CHANNEL" -n "$CC_NAME" -c "$1"; }

cmd_stop() {
  local all; all=$(fabric_containers "--filter status=running")
  [ -z "$all" ] && { warn "Nothing running."; return 0; }
  info "Stopping (ledgers, state and identities are kept):"
  for c in $(echo "$all" | grep -- '-cc$'; echo "$all" | grep '^peer0\.'; echo "$all" | grep '^orderer\.'; echo "$all" | grep '^ca\.'); do
    docker stop "$c" >/dev/null && echo "  stopped  $c"
  done
  ok "Stopped. Resume with: ./network.sh start"
}

cmd_start() {
  local all; all=$(fabric_containers)
  [ -z "$all" ] && die "No BFT network to resume. Create one with: ./network.sh all"
  info "Starting from persisted state:"
  for group in '^ca\.' '^orderer\.' '^peer0\.' '-cc$'; do
    for c in $(echo "$all" | grep -- "$group"); do docker start "$c" >/dev/null && echo "  started  $c"; done
    sleep 3
  done
  ok "Resumed."
}

cmd_down() {
  warn "WIPING the BFT network: containers, ledger volumes, identities and channel artefacts will be DELETED."
  docker rm -f $(docker ps -aq --filter label=fabric.role=chaincode --filter network=custodychain_bft) >/dev/null 2>&1 || true
  $COMPOSE down --volumes --remove-orphans 2>&1 | grep -v 'level=warning' || true
  # identities were created by this user, but remove via a container in case any file is root-owned
  docker run --rm -v "$PWD:/data" busybox sh -c 'rm -rf /data/organizations /data/channel-artifacts' >/dev/null 2>&1 || true
  ok "Wiped."
}

# The v2 evidence-registry chaincode (D-037), deployed next to the authors' 'custody' chaincode
deploy_v2() { ( CC_NAME=evidence; CC_SRC=../chaincode-v2; CC_VERSION=${V2_VERSION:-2.0}; CC_SEQUENCE=${V2_SEQUENCE:-1}; cmd_deploy ); }

# Allow `NETWORK_SH_LIB=1 source network.sh` from test scripts
[ "${NETWORK_SH_LIB:-0}" = 1 ] && return 0

case "${1:-}" in
  up) cmd_up ;;
  channel) cmd_channel ;;
  deploy) cmd_deploy ;;
  all) cmd_up; sleep 5; cmd_channel; cmd_deploy; deploy_v2; cmd_users ;;
  users) cmd_users ;;
  deploy-v2) deploy_v2 ;;
  status) cmd_status ;;
  invoke) cmd_invoke "${2:?JSON args required}" ;;
  query) cmd_query "${2:?JSON args required}" ;;
  stop) cmd_stop ;;
  start) cmd_start ;;
  down) cmd_down ;;
  *) sed -n '2,19p' "$0"; exit 1 ;;
esac
