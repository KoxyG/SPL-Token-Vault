import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SecureVault } from "../target/types/secure_vault";
import { TOKEN_PROGRAM_ID, createMint, createAccount, mintTo } from "@solana/spl-token";
import { expect } from "chai";

describe("secure-vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SecureVault as Program<SecureVault>;
  
  let vaultPda: anchor.web3.PublicKey;
  let vaultBump: number;
  let tokenMint: anchor.web3.PublicKey;
  let managerTokenAccount: anchor.web3.PublicKey;
  let depositorTokenAccount: anchor.web3.PublicKey;
  let vaultTokenAccount: anchor.web3.PublicKey;
  
  const manager = anchor.web3.Keypair.generate();
  const depositor = anchor.web3.Keypair.generate();
  
  before(async () => {
    // Airdrop SOL to manager and depositor
    await provider.connection.requestAirdrop(manager.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(depositor.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);

    // Create token mint
    tokenMint = await createMint(
      provider.connection,
      manager,
      manager.publicKey,
      null,
      9
    );


    // Create token accounts
    managerTokenAccount = await createAccount(
      provider.connection,
      manager,
      tokenMint,
      manager.publicKey
    );
    
    depositorTokenAccount = await createAccount(
      provider.connection,
      depositor,
      tokenMint,
      depositor.publicKey
    );

    // Mint tokens to depositor
    const minting = await mintTo(
      provider.connection,
      depositor,
      tokenMint,
      depositorTokenAccount,
      manager,
      1000 * 10**9 // 1000 tokens
    );

    console.log("Mint token", minting)

    // Derive PDA for vault
    [vaultBump] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("vault"), manager.publicKey.toBuffer()],
      program.programId
    );

    // Create vault token account
    vaultTokenAccount = await createAccount(
      provider.connection,
      manager,
      tokenMint,
      vaultPda
    );
  });

  it("Initializes the vault", async () => {
    await program.methods
      .initialize()
      .accounts({
        initializer: manager.publicKey,
        vaultPda: vaultPda,
        tokenMint: tokenMint,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([manager])
      .rpc();

    const vaultAccount = await program.account.vaultState.fetch(vaultPda);
    expect(vaultAccount.manager.toString()).to.equal(manager.publicKey.toString());
    expect(vaultAccount.tokenMint.toString()).to.equal(tokenMint.toString());
  });

  it("Deposits tokens into the vault", async () => {
    const depositAmount = new anchor.BN(100 * 10**9); // 100 tokens

    await program.methods
      .deposit(depositAmount)
      .accounts({
        depositor: depositor.publicKey,
        depositorTokenAccount: depositorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        tokenMint: tokenMint,
        vaultPda: vaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([depositor])
      .rpc();

    const vaultBalance = await provider.connection.getTokenAccountBalance(vaultTokenAccount);
    expect(vaultBalance.value.uiAmount).to.equal(100);
  });

  it("Withdraws tokens from the vault", async () => {
    const withdrawAmount = new anchor.BN(50 * 10**9); // 50 tokens

    await program.methods
      .withdraw(withdrawAmount)
      .accounts({
        vaultPda: vaultPda,
        vaultTokenAccount: vaultTokenAccount,
        recipientTokenAccount: depositorTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        withdrawer: depositor.publicKey,
      })
      .signers([depositor])
      .rpc();

    const vaultBalance = await provider.connection.getTokenAccountBalance(vaultTokenAccount);
    expect(vaultBalance.value.uiAmount).to.equal(50);

    const depositorBalance = await provider.connection.getTokenAccountBalance(depositorTokenAccount);
    expect(depositorBalance.value.uiAmount).to.equal(950);
  });

  it("Prevents manager from withdrawing", async () => {
    const withdrawAmount = new anchor.BN(50 * 10**9); // 50 tokens

    try {
      await program.methods
        .withdraw(withdrawAmount)
        .accounts({
          vaultPda: vaultPda,
          vaultTokenAccount: vaultTokenAccount,
          recipientTokenAccount: managerTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          withdrawer: manager.publicKey,
        })
        .signers([manager])
        .rpc();
      
      // If we reach here, the test should fail
      expect.fail("Manager should not be able to withdraw");
    } catch (error) {
      expect(error.error.errorMessage).to.equal("The manager cannot withdraw funds");
    }
  });

  it("Prevents depositing invalid token", async () => {
    // Create a new token mint
    const invalidTokenMint = await createMint(
      provider.connection,
      manager,
      manager.publicKey,
      null,
      9
    );

    // Create a token account for the invalid token
    const invalidTokenAccount = await createAccount(
      provider.connection,
      depositor,
      invalidTokenMint,
      depositor.publicKey
    );

    // Mint some invalid tokens
    await mintTo(
      provider.connection,
      depositor,
      invalidTokenMint,
      invalidTokenAccount,
      manager,
      100 * 10**9 // 100 tokens
    );

    const depositAmount = new anchor.BN(100 * 10**9); // 100 tokens

    try {
      await program.methods
        .deposit(depositAmount)
        .accounts({
          depositor: depositor.publicKey,
          depositorTokenAccount: invalidTokenAccount,
          vaultTokenAccount: vaultTokenAccount,
          tokenMint: invalidTokenMint,
          vaultPda: vaultPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([depositor])
        .rpc();
      
      // If we reach here, the test should fail
      expect.fail("Should not be able to deposit invalid token");
    } catch (error) {
      expect(error.error.errorMessage).to.equal("Invalid token mint");
    }
  });
});