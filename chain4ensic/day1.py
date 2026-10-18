"""
Day 1: the Chain4ensic crypto pipeline with NO blockchain.
Steps: encrypt file -> hash ciphertext -> split key (3-of-5) -> wrap each share
for a different 'authority' -> recover with 3 authorities -> decrypt -> verify.

Setup:  pip install cryptography pycryptodome
Run:    python3 day1_pipeline.py
"""
import os
import hashlib
import random

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from Crypto.Protocol.SecretSharing import Shamir

K, N = 4, 5  # any 3 of 5 authorities can rebuild the key
OAEP = padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None)


def encrypt_file(plaintext: bytes):
    key = AESGCM.generate_key(bit_length=256)
    nonce = os.urandom(12)
    return key, nonce + AESGCM(key).encrypt(nonce, plaintext, None)


def decrypt_file(key: bytes, blob: bytes) -> bytes:
    return AESGCM(key).decrypt(blob[:12], blob[12:], None)  # raises if key is wrong or data tampered


def split_key(key: bytes):
    # PyCryptodome's Shamir only handles 16-byte secrets, so split the 32-byte key in two halves.
    a, b = Shamir.split(K, N, key[:16]), Shamir.split(K, N, key[16:])
    return [bytes([i]) + sa + sb for (i, sa), (_, sb) in zip(a, b)]  # 33 bytes per share


def combine_shares(shares):
    a = [(s[0], s[1:17]) for s in shares]
    b = [(s[0], s[17:33]) for s in shares]
    return Shamir.combine(a) + Shamir.combine(b)


def main():
    evidence = os.urandom(1024) + b"  <- pretend this is an IoT traffic log"

    # 1. Gateway side
    key, ciphertext = encrypt_file(evidence)
    file_hash = hashlib.sha256(ciphertext).hexdigest()  # this is what would go on-chain
    print("on-chain hash :", file_hash)

    authorities = [rsa.generate_private_key(public_exponent=65537, key_size=2048) for _ in range(N)]
    wrapped = [auth.public_key().encrypt(share, OAEP)
               for auth, share in zip(authorities, split_key(key))]
    print("wrapped shares:", len(wrapped), "x", len(wrapped[0]), "bytes (does not fit in a bytes32)")

    # 2. Investigation side: 3 authorities agree and release their shares
    chosen = random.sample(range(N), K)
    released = [authorities[i].decrypt(wrapped[i], OAEP) for i in chosen]
    recovered_key = combine_shares(released)

    assert hashlib.sha256(ciphertext).hexdigest() == file_hash, "ciphertext was tampered with"
    assert decrypt_file(recovered_key, ciphertext) == evidence
    print(f"OK: authorities {chosen} recovered the evidence")

    # 3. Only 2 authorities: must NOT work
    try:
        decrypt_file(combine_shares(released[:2]), ciphertext)
        print("BUG: 2 shares should not decrypt")
    except Exception:
        print("OK: 2 authorities cannot decrypt")


if __name__ == "__main__":
    main()