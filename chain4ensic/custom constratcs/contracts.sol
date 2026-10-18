// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.7 <0.9.0;

//Smart Contract Storage
contract NewEvidence_SmartContractStorage {
    address public verifier;
    address public owner;
    uint256 public fileCount = 0;
    mapping(uint256 => File) public files;
    mapping(bytes32 => bool) public verfication;

    struct File {
        uint256 fileId;
        bytes32 fileHash;
        address payable uploader;
    }

    event EvidenceAdded(
        uint256 fileId,
        bytes32 fileHash,
        address payable uploader
    );

    event KeyExchange(address payable recipient, bytes32 encryptedFragment);

    modifier onlyOwner() {
        require(
            msg.sender == owner,
            "Only the contract owner can call this method"
        );
        _;
    }

    modifier onlyVerifier() {
        require(
            msg.sender == verifier,
            "Only the verfier can call this method"
        );
        _;
    }

    function newevidence(bytes32 _fileHash) external onlyOwner {
        fileCount++;

        files[fileCount] = File(fileCount, _fileHash, payable(msg.sender));

        emit EvidenceAdded(fileCount, _fileHash, payable(msg.sender));
    }

    function verify(bytes32 _fileHash) external onlyVerifier {
        verfication[_fileHash] = true;
    }

    function retriveFileAtIndex(
        uint256 index
    ) external view returns (File memory) {
        return files[index];
    }

    function isVerified(bytes32 _fileHash) external view returns (bool) {
        return verfication[_fileHash];
    }

    //recipient is the trusted authority address, encryptedfragment the SSS fragment encrypted with that trusted authority public key
    function keyExchange(
        address payable recipient,
        bytes32 encryptedfragment
    ) external onlyOwner {
        emit KeyExchange(recipient, encryptedfragment);
    }

    constructor(address _owner, address _verifier) {
        owner = _owner;
        verifier = _verifier;
    }
}

//Smart Contract Factory with zeroknowledge proof, to deploy without comment row require(verifyTx....
contract SmartContractFactory {
    mapping(address => address) public userToContract;
    mapping(address => bool) public hasCreatedContract;

    //ZPN
    using Pairing for *;
    struct VerifyingKey {
        Pairing.G1Point alpha;
        Pairing.G2Point beta;
        Pairing.G2Point gamma;
        Pairing.G2Point delta;
        Pairing.G1Point[] gamma_abc;
    }
    struct Proof {
        Pairing.G1Point a;
        Pairing.G2Point b;
        Pairing.G1Point c;
    }

    function verifyingKey() internal pure returns (VerifyingKey memory vk) {
        vk.alpha = Pairing.G1Point(
            uint256(
                0x2fc8174992b52962942b1617335b18faa39441ef21cdca0725c3ac5783c8f4f6
            ),
            uint256(
                0x0ea13d27417218bca4ace508e082cfde00e6500a7112d45ac6576cf45d1b1cb5
            )
        );
        vk.beta = Pairing.G2Point(
            [
                uint256(
                    0x07b454753ce51c6eac02b90ee3900029300c76953c859b1ff8034fb7311af89c
                ),
                uint256(
                    0x220fcf6ee830fd6eadd4c1331d3f0efe060161bd11d4112cead61c2dbaf04ea3
                )
            ],
            [
                uint256(
                    0x1d2591e5ac9d14a70c5cb19d1ed2ea829d3836d8abe8a4ac5d31a00781f8a2a9
                ),
                uint256(
                    0x01b2813d0ddbed7d93343bc8d33f390d04991f59c6e103b7806a88985a47afca
                )
            ]
        );
        vk.gamma = Pairing.G2Point(
            [
                uint256(
                    0x11c4fd22673ead93f86a1500cff757c6ba43a14a0fe5a3d09115307b0d2f045d
                ),
                uint256(
                    0x08bd2d163805c8d340efb197af4c0ba9551b287576aa0cefd3a05b19b2e1d2df
                )
            ],
            [
                uint256(
                    0x2dae06d90d1831fa0773ac947fb3a47be1cbfc94739cc004c26a849a0b400484
                ),
                uint256(
                    0x2bcea76a0e4bb33e09324788d5ae586c8bf1941642d7dc9d991fbef360cc53bd
                )
            ]
        );
        vk.delta = Pairing.G2Point(
            [
                uint256(
                    0x1475c2c207f74e94a1518946d59553080d3d73c3687819157908196942f48866
                ),
                uint256(
                    0x1c78fd13e774d6076d01ab99583c7088c8104f92383b4adbacf9b88d863a83c9
                )
            ],
            [
                uint256(
                    0x263c8c6b62e5670a41652861360b919477851a3534a670185102a8e5b9666da9
                ),
                uint256(
                    0x096a96c1bf87499c776dade45a669d2042f3427491d6f3e2f904e165148d8e5d
                )
            ]
        );
        vk.gamma_abc = new Pairing.G1Point[](1);
        vk.gamma_abc[0] = Pairing.G1Point(
            uint256(
                0x173e8fe87cd8c90dc4cfc61d485e97320e36ae6b35967d1aa1c6bad197cfba01
            ),
            uint256(
                0x12cc80b2970399e15af026fa1bc92c42f58d139b25bc3d5c12e1d031ac9eaff2
            )
        );
    }
    function verify(
        uint[] memory input,
        Proof memory proof
    ) internal view returns (uint) {
        uint256 snark_scalar_field = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
        VerifyingKey memory vk = verifyingKey();
        require(input.length + 1 == vk.gamma_abc.length);
        // Compute the linear combination vk_x
        Pairing.G1Point memory vk_x = Pairing.G1Point(0, 0);
        for (uint i = 0; i < input.length; i++) {
            require(input[i] < snark_scalar_field);
            vk_x = Pairing.addition(
                vk_x,
                Pairing.scalar_mul(vk.gamma_abc[i + 1], input[i])
            );
        }
        vk_x = Pairing.addition(vk_x, vk.gamma_abc[0]);
        if (
            !Pairing.pairingProd4(
                proof.a,
                proof.b,
                Pairing.negate(vk_x),
                vk.gamma,
                Pairing.negate(proof.c),
                vk.delta,
                Pairing.negate(vk.alpha),
                vk.beta
            )
        ) return 1;
        return 0;
    }
    function verifyTx(Proof memory proof) public view returns (bool r) {
        uint[] memory inputValues = new uint[](0);

        if (verify(inputValues, proof) == 0) {
            return true;
        } else {
            return false;
        }
    }
    //

    event ContractCreated(
        address indexed user,
        address indexed contractAddress
    );

    function createSmartContract(
        address _verfier //Proof memory proof
    ) external {
        ///////                         ///////
        //require(verifyTx(proof), "Not Authorized");
        ///////                         ///////

        require(
            !hasCreatedContract[msg.sender],
            "You have already created a smart contract"
        );

        // Create a new smart contract with the caller as the owner
        NewEvidence_SmartContractStorage newContract = new NewEvidence_SmartContractStorage(
                msg.sender,
                _verfier
            );

        // Store the mapping between the user and the created contract address
        userToContract[msg.sender] = address(newContract);
        hasCreatedContract[msg.sender] = true;

        emit ContractCreated(msg.sender, address(newContract));
    }
}

//ZNP Library
library Pairing {
    struct G1Point {
        uint X;
        uint Y;
    }
    // Encoding of field elements is: X[0] * z + X[1]
    struct G2Point {
        uint[2] X;
        uint[2] Y;
    }
    /// @return the generator of G1
    function P1() internal pure returns (G1Point memory) {
        return G1Point(1, 2);
    }
    /// @return the generator of G2
    function P2() internal pure returns (G2Point memory) {
        return
            G2Point(
                [
                    10857046999023057135944570762232829481370756359578518086990519993285655852781,
                    11559732032986387107991004021392285783925812861821192530917403151452391805634
                ],
                [
                    8495653923123431417604973247489272438418190587263600148770280649306958101930,
                    4082367875863433681332203403145435568316851327593401208105741076214120093531
                ]
            );
    }
    /// @return the negation of p, i.e. p.addition(p.negate()) should be zero.
    function negate(G1Point memory p) internal pure returns (G1Point memory) {
        // The prime q in the base field F_q for G1
        uint q = 21888242871839275222246405745257275088696311157297823662689037894645226208583;
        if (p.X == 0 && p.Y == 0) return G1Point(0, 0);
        return G1Point(p.X, q - (p.Y % q));
    }
    /// @return r the sum of two points of G1
    function addition(
        G1Point memory p1,
        G1Point memory p2
    ) internal view returns (G1Point memory r) {
        uint[4] memory input;
        input[0] = p1.X;
        input[1] = p1.Y;
        input[2] = p2.X;
        input[3] = p2.Y;
        bool success;
        assembly {
            success := staticcall(sub(gas(), 2000), 6, input, 0xc0, r, 0x60)
            // Use "invalid" to make gas estimation work
            switch success
            case 0 {
                invalid()
            }
        }
        require(success);
    }

    /// @return r the product of a point on G1 and a scalar, i.e.
    /// p == p.scalar_mul(1) and p.addition(p) == p.scalar_mul(2) for all points p.
    function scalar_mul(
        G1Point memory p,
        uint s
    ) internal view returns (G1Point memory r) {
        uint[3] memory input;
        input[0] = p.X;
        input[1] = p.Y;
        input[2] = s;
        bool success;
        assembly {
            success := staticcall(sub(gas(), 2000), 7, input, 0x80, r, 0x60)
            // Use "invalid" to make gas estimation work
            switch success
            case 0 {
                invalid()
            }
        }
        require(success);
    }
    /// @return the result of computing the pairing check
    /// e(p1[0], p2[0]) *  .... * e(p1[n], p2[n]) == 1
    /// For example pairing([P1(), P1().negate()], [P2(), P2()]) should
    /// return true.
    function pairing(
        G1Point[] memory p1,
        G2Point[] memory p2
    ) internal view returns (bool) {
        require(p1.length == p2.length);
        uint elements = p1.length;
        uint inputSize = elements * 6;
        uint[] memory input = new uint[](inputSize);
        for (uint i = 0; i < elements; i++) {
            input[i * 6 + 0] = p1[i].X;
            input[i * 6 + 1] = p1[i].Y;
            input[i * 6 + 2] = p2[i].X[1];
            input[i * 6 + 3] = p2[i].X[0];
            input[i * 6 + 4] = p2[i].Y[1];
            input[i * 6 + 5] = p2[i].Y[0];
        }
        uint[1] memory out;
        bool success;
        assembly {
            success := staticcall(
                sub(gas(), 2000),
                8,
                add(input, 0x20),
                mul(inputSize, 0x20),
                out,
                0x20
            )
            // Use "invalid" to make gas estimation work
            switch success
            case 0 {
                invalid()
            }
        }
        require(success);
        return out[0] != 0;
    }
    /// Convenience method for a pairing check for two pairs.
    function pairingProd2(
        G1Point memory a1,
        G2Point memory a2,
        G1Point memory b1,
        G2Point memory b2
    ) internal view returns (bool) {
        G1Point[] memory p1 = new G1Point[](2);
        G2Point[] memory p2 = new G2Point[](2);
        p1[0] = a1;
        p1[1] = b1;
        p2[0] = a2;
        p2[1] = b2;
        return pairing(p1, p2);
    }
    /// Convenience method for a pairing check for three pairs.
    function pairingProd3(
        G1Point memory a1,
        G2Point memory a2,
        G1Point memory b1,
        G2Point memory b2,
        G1Point memory c1,
        G2Point memory c2
    ) internal view returns (bool) {
        G1Point[] memory p1 = new G1Point[](3);
        G2Point[] memory p2 = new G2Point[](3);
        p1[0] = a1;
        p1[1] = b1;
        p1[2] = c1;
        p2[0] = a2;
        p2[1] = b2;
        p2[2] = c2;
        return pairing(p1, p2);
    }
    /// Convenience method for a pairing check for four pairs.
    function pairingProd4(
        G1Point memory a1,
        G2Point memory a2,
        G1Point memory b1,
        G2Point memory b2,
        G1Point memory c1,
        G2Point memory c2,
        G1Point memory d1,
        G2Point memory d2
    ) internal view returns (bool) {
        G1Point[] memory p1 = new G1Point[](4);
        G2Point[] memory p2 = new G2Point[](4);
        p1[0] = a1;
        p1[1] = b1;
        p1[2] = c1;
        p1[3] = d1;
        p2[0] = a2;
        p2[1] = b2;
        p2[2] = c2;
        p2[3] = d2;
        return pairing(p1, p2);
    }
}
