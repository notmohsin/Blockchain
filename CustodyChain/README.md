# CustodyChain

> A blockchain-based **Chain of Custody** system for digital forensic evidence, built on **Hyperledger Fabric**.  
> Ensures tamper-proof, auditable tracking of evidence from collection to court.

>**Based on** [leandroloffi/CustodyChain](https://github.com/leandroloffi/CustodyChain) — original work by [@leandroloffi](https://github.com/leandroloffi).

---

## Architecture

```
CustodyChain/
├── backend/
│   ├── network/        # Hyperledger Fabric network (Fabric Test Network)
│   ├── chaincode/      # Smart contracts (JavaScript)
│   └── gateway/        # Node.js API gateway (PORT 3000)
└── frontend/           # Svelte web app (PORT 5173)
```

---

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/notmohsin/Blockchain
cd Blockchain/CustodyChain
```

### 2. Install Dependencies

```bash
# System packages
sudo apt-get install -y git curl docker-compose npm jq
sudo apt install python3-distutils-extra

# Start & enable Docker
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker $USER   # log out and back in after this

# Verify
docker --version
docker-compose --version
```

### 3. Start the Fabric Network

```bash
cd backend/network/

# Tear down any previous network
./network.sh down

# Bring up network, create channel, and deploy chaincode
./network.sh up createChannel -c mychannel -ca
./network.sh deployCC -ccn basic -ccp ../chaincode/ -ccl javascript
```

### 4. Start the API Gateway — `http://localhost:3000`

```bash
cd ../gateway/
npm install
node src/app.js
```

### 5. Start the Frontend — `http://localhost:5173`

```bash
# Open a new terminal
cd frontend/
npm install
npm install express
npm run dev -- --host
```

---

## Shutting Down

```bash
cd backend/network/
./network.sh down
```

## Tech Stack

| Layer | Technology |
|---|---|
| Blockchain | Hyperledger Fabric |
| Smart Contracts | JavaScript (Fabric Chaincode) |
| Backend Gateway | Node.js / Express |
| Frontend | Svelte + Vite |
| Infrastructure | Docker / Docker Compose |

---

## Prerequisites

- Docker ≥ 20.x
- Docker Compose ≥ 1.29
- Node.js ≥ 18.x
- npm ≥ 9.x
- jq
