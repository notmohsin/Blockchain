// SPDX-License-Identifier: GPL-3.0
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Counters.sol";


pragma solidity >=0.7 <0.9.0;


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
    function verifyingKey() pure internal returns (VerifyingKey memory vk) {
        vk.alpha = Pairing.G1Point(uint256(0x2fc8174992b52962942b1617335b18faa39441ef21cdca0725c3ac5783c8f4f6), uint256(0x0ea13d27417218bca4ace508e082cfde00e6500a7112d45ac6576cf45d1b1cb5));
        vk.beta = Pairing.G2Point([uint256(0x07b454753ce51c6eac02b90ee3900029300c76953c859b1ff8034fb7311af89c), uint256(0x220fcf6ee830fd6eadd4c1331d3f0efe060161bd11d4112cead61c2dbaf04ea3)], [uint256(0x1d2591e5ac9d14a70c5cb19d1ed2ea829d3836d8abe8a4ac5d31a00781f8a2a9), uint256(0x01b2813d0ddbed7d93343bc8d33f390d04991f59c6e103b7806a88985a47afca)]);
        vk.gamma = Pairing.G2Point([uint256(0x11c4fd22673ead93f86a1500cff757c6ba43a14a0fe5a3d09115307b0d2f045d), uint256(0x08bd2d163805c8d340efb197af4c0ba9551b287576aa0cefd3a05b19b2e1d2df)], [uint256(0x2dae06d90d1831fa0773ac947fb3a47be1cbfc94739cc004c26a849a0b400484), uint256(0x2bcea76a0e4bb33e09324788d5ae586c8bf1941642d7dc9d991fbef360cc53bd)]);
        vk.delta = Pairing.G2Point([uint256(0x1475c2c207f74e94a1518946d59553080d3d73c3687819157908196942f48866), uint256(0x1c78fd13e774d6076d01ab99583c7088c8104f92383b4adbacf9b88d863a83c9)], [uint256(0x263c8c6b62e5670a41652861360b919477851a3534a670185102a8e5b9666da9), uint256(0x096a96c1bf87499c776dade45a669d2042f3427491d6f3e2f904e165148d8e5d)]);
        vk.gamma_abc = new Pairing.G1Point[](1);
        vk.gamma_abc[0] = Pairing.G1Point(uint256(0x173e8fe87cd8c90dc4cfc61d485e97320e36ae6b35967d1aa1c6bad197cfba01), uint256(0x12cc80b2970399e15af026fa1bc92c42f58d139b25bc3d5c12e1d031ac9eaff2));
    }
    function verify(uint[] memory input, Proof memory proof) internal view returns (uint) {
        uint256 snark_scalar_field = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
        VerifyingKey memory vk = verifyingKey();
        require(input.length + 1 == vk.gamma_abc.length);
        // Compute the linear combination vk_x
        Pairing.G1Point memory vk_x = Pairing.G1Point(0, 0);
        for (uint i = 0; i < input.length; i++) {
            require(input[i] < snark_scalar_field);
            vk_x = Pairing.addition(vk_x, Pairing.scalar_mul(vk.gamma_abc[i + 1], input[i]));
        }
        vk_x = Pairing.addition(vk_x, vk.gamma_abc[0]);
        if(!Pairing.pairingProd4(
             proof.a, proof.b,
             Pairing.negate(vk_x), vk.gamma,
             Pairing.negate(proof.c), vk.delta,
             Pairing.negate(vk.alpha), vk.beta)) return 1;
        return 0;
    }
    function verifyTx(
            Proof memory proof
        ) public view returns (bool r) {
        uint[] memory inputValues = new uint[](0);
        
        if (verify(inputValues, proof) == 0) {
            return true;
        } else {
            return false;
        }
    }
    //



    event ContractCreated(address indexed user, address indexed contractAddress);

    function createSmartContract(address _verfier, Proof proof) external {

        ///////                         ///////
        require(verifyTx(proof), "Not Authorized");
        ///////                         ///////

        require(!hasCreatedContract[msg.sender], "You have already created a smart contract");

        // Create a new smart contract with the caller as the owner
        NewEvidence_SmartContractStorage newContract = new NewEvidence_SmartContractStorage(msg.sender, _verfier);

        // Store the mapping between the user and the created contract address
        userToContract[msg.sender] = address(newContract);
        hasCreatedContract[msg.sender] = true;

        emit ContractCreated(msg.sender, address(newContract));
    }
}
