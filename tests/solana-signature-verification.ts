import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Ed25519Program, LAMPORTS_PER_SOL, SystemProgram, Transaction, Connection, Keypair, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import { SolanaSignatureVerification } from "../target/types/solana_signature_verification";
import * as ed from '@noble/ed25519';
import * as fs from 'fs';
import * as path from 'path';
import { Big } from "@switchboard-xyz/common";
import {
  AggregatorAccount,
  AnchorWallet,
  SwitchboardProgram,
} from "@switchboard-xyz/solana.js";
import { confirmTransaction } from "@solana-developers/helpers";
import { assert, expect } from 'chai';
export const solUSDSwitchboardFeed = new anchor.web3.PublicKey(
  "GvDMxPzN1sCj7L26YDK2HnMRXEQmQ2aemov8YBtPS7vR",
);
const MSG = Buffer.from('this is such a good message to sign');
const keypairPath = path.resolve('/home/mubariz/.config/solana/id.json');
// Change to your file path
const keypairJSON = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
// Create Keypair from the loaded JSON
const originalKeypair = anchor.web3.Keypair.fromSecretKey(new Uint8Array(keypairJSON));
// Create a new payer keypair (the one to which you want to transfer lamports)
const payer = anchor.web3.Keypair.generate();

let signature: Uint8Array;
let aggregatorAccount: AggregatorAccount;
let switchboardProgram: SwitchboardProgram;
describe("solana-signature-verification", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SolanaSignatureVerification as Program<SolanaSignatureVerification>;
  async function transferLamports(
    connection: Connection,
    fromKeypair: Keypair,
    toPubkey: PublicKey,
    amountInSol: number
  ) {
    try {
      // Convert SOL to lamports
      const lamportsToTransfer = amountInSol * LAMPORTS_PER_SOL;

      // Create transfer transaction
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: fromKeypair.publicKey,
          toPubkey: toPubkey,
          lamports: lamportsToTransfer,
        })
      );

      // Fetch latest blockhash
      const { blockhash } = await connection.getLatestBlockhash("finalized");
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = fromKeypair.publicKey;

      // Sign and send transaction
      const signature = await sendAndConfirmTransaction(connection, transaction, [fromKeypair]);

      console.log(`✅ Transfer successful! TX Signature: ${signature}`);
      return signature;
    } catch (error) {
      console.error("❌ Transfer failed:", error);
      throw error;
    }
  }
  before(async () => {



    // Generate ed25519 signature
    signature = await ed.sign(MSG, payer.secretKey.slice(0, 32));
    // Verify signature locally before sending to chain
    const isValid = await ed.verify(signature, MSG, payer.publicKey.toBytes());
    expect(isValid).to.be.true;
    switchboardProgram = await SwitchboardProgram.load(
      new anchor.web3.Connection("https://api.devnet.solana.com"),
      payer,
    );

    aggregatorAccount = new AggregatorAccount(
      switchboardProgram,
      solUSDSwitchboardFeed,
    );

  });
  it("creates Escrow below price", async () => {
    const balance = await provider.connection.getBalance(originalKeypair.publicKey);
    console.log(`Original Balance: ${balance} lamports`);
    await transferLamports(provider.connection, originalKeypair, payer.publicKey, 0.01);
    // show new balance 
    const new_balance = await provider.connection.getBalance(payer.publicKey);
    console.log(`New Balance: ${new_balance} lamports`);
    try {

      const solPrice: Big | null = await aggregatorAccount.fetchLatestValue();
      if (solPrice === null) {
        throw new Error("Aggregator holds no value");
      }
      const UnlockPrice = new anchor.BN(solPrice.minus(10).toNumber());
      const amountToLockUp = new anchor.BN(100);


      const [escrowState] = await anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("get the best weed from us"), payer.publicKey.toBuffer()],
        program.programId,
      );

      console.log("Escrow state (public key):", escrowState.toBase58()); // Debugging line


      console.log("Creating escrow account..."); // Debugging line

      const tx = new anchor.web3.Transaction();

      tx.add(
        Ed25519Program.createInstructionWithPublicKey({
          publicKey: payer.publicKey.toBytes(),
          message: MSG,
          signature: signature,
        })
      );

      tx.add(
        await program.methods.deposit(amountToLockUp,
          UnlockPrice)
          .accounts({
            user: payer.publicKey,
            escrowAccount: escrowState,
            systemProgram: anchor.web3.SystemProgram.programId,
            instructions: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
          })
          .signers([payer])
          .instruction()
      );



      // Re - fetch the latest blockhash to ensure it's still valid
      let blockhash = (await provider.connection.getLatestBlockhash('finalized')).blockhash;

      let blockheight = await provider.connection.getBlockHeight("confirmed");
      // Set the new blockhash in the transaction
      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = blockheight;
      tx.sign(payer); // always sign after getting block hash
      // await provider.connection.sendRawTransaction(tx.serialize());

      const txid = await provider.connection.sendRawTransaction(tx.serialize());
      await provider.connection.confirmTransaction(
        txid
      );


      console.log("Escrow created successfully. TX:", txid); // Debugging line

      const escrowAccount = await program.account.escrowState.fetch(escrowState);

      console.log("done");
      const escrowBalance = await provider.connection.getBalance(escrowState, "confirmed");
      console.log("Onchain unlock price:", escrowAccount.unlockPrice);
      console.log("Amount in escrow:", escrowBalance);


      // Check whether the data on-chain is equal to local 'data'
      //assert(UnlockPrice == escrowAccount.unlockPrice)
      console.log('Escrow Account:', escrowAccount);
      console.log('Escrow Account Unlock Price:', escrowAccount.unlockPrice ? escrowAccount.unlockPrice.toString() : 'undefined');
      // console.log('Calculated Unlock Price:', escrowAccount.unlockPrice.toString());
      assert(UnlockPrice.eq(escrowAccount.unlockPrice), "Unlock price mismatch!");
      assert(escrowBalance > 0)
    } catch (error) {
      console.error("Error details:", error.logs);
      throw new Error(`Failed to create escrow: ${error.message}`);
    }

  });


  it("withdraws from escrow", async () => {
    const [escrowState] = await anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("get the best weed from us"), payer.publicKey.toBuffer()],
      program.programId,
    );

    const userBalanceBefore = await provider.connection.getBalance(
      payer.publicKey
    );

    try {
      const tx = new anchor.web3.Transaction();

      tx.add(
        Ed25519Program.createInstructionWithPublicKey({
          publicKey: payer.publicKey.toBytes(),
          message: MSG,
          signature: signature,
        })
      );
      tx.add(
        await program.methods
          .withdraw({ maxConfidenceInterval: null })
          .accounts({
            user: payer.publicKey,
            escrowAccount: escrowState,
            feedAggregator: solUSDSwitchboardFeed,
            systemProgram: anchor.web3.SystemProgram.programId,
            instructions: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
          })
          .signers([payer]).instruction()
      );
      // Re - fetch the latest blockhash to ensure it's still valid
      let blockhash = (await provider.connection.getLatestBlockhash('finalized')).blockhash;

      let blockheight = await provider.connection.getBlockHeight("confirmed");
      // Set the new blockhash in the transaction
      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = blockheight;
      tx.sign(payer); // always sign after getting block hash
      // await provider.connection.sendRawTransaction(tx.serialize());

      const txid = await provider.connection.sendRawTransaction(tx.serialize());
      await provider.connection.confirmTransaction(
        txid
      );



      // Verify escrow account is closed
      try {
        await program.account.escrowState.fetch(escrowState);
        assert.fail("Escrow account should have been closed");
      } catch (error) {
        console.log(error.message);
        assert(
          error.message.includes("Account does not exist"),
          "Unexpected error: " + error.message
        );
      }

      // Verify user balance increased
      const userBalanceAfter = await provider.connection.getBalance(
        payer.publicKey
      );
      assert(
        userBalanceAfter > userBalanceBefore,
        "User balance should have increased"
      );

      // transfer money back to original keypair
      const balance = await provider.connection.getBalance(payer.publicKey);

      console.log(`Original Balance: ${balance} lamports`);
      await transferLamports(provider.connection, payer, originalKeypair.publicKey, 0.001);

    } catch (error) {
      console.error("Error details:", error.transactionMessage);
      throw new Error(`Failed to withdraw from escrow: ${error.message}`);
    }

  });

});

