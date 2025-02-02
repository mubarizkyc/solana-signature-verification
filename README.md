# Solana Program: Unlocking a Vault Based on SOL Price and Signature Verification
This Solana escrow program allows users to withdraw funds only when the SOL price reaches a certain target and after verifying their Ed25519 signature.
## Ed25519 Signature Verification
In Solana, programs cannot directly call the Ed25519 program using a CPI (Cross-Program Invocation) because signature verification is computationally expensive. Instead, the Ed25519 signature verification program exists as a precompiled instruction outside the Solana Virtual Machine (SVM).
we do verification by passing two instructions one [Ed25519 program](https://github.com/anza-xyz/agave/blob/master/sdk/ed25519-program/src/lib.rs) ix and second our custom logic ix (it mush have a sysvar ix to get current chain state)

The sysvar instructions account provides access to all instructions within the same transaction.
This allows our program to fetch and verify the arguments passed to the Ed25519 program, ensuring they were correctly signed before unlocking funds.
# Vault Unlock Conditions
The SOL price must meet or exceed the target threshold & Ed25519 signature must be verified
# Vault Architecture
```mermaid
flowchart TD
    %% Set Global Styles
    classDef darkBackground fill:#222222,stroke:#000000,stroke-width:2,color:#ffffff,font-size:16px;
    classDef boxStyle fill:#333333,stroke:#000000,stroke-width:2,color:#ffffff,font-size:18px;
    classDef subBoxStyle fill:#444444,stroke:#000000,stroke-width:2,color:#ffffff,font-size:16px;
    classDef lighterBoxStyle fill:#555555,stroke:#000000,stroke-width:2,color:#ffffff,font-size:16px;

    %% User Actions
    subgraph User["User Actions"]
        class User darkBackground
        Deposit["Deposit SOL + Ed25519 Sig"]
        Withdraw["Withdraw Request + Ed25519 Sig"]
    end

    %% Escrow Program
    subgraph Program["Escrow Program"]
        class Program boxStyle

        %% Signature Verification
        subgraph SigVerification["Ed25519 Signature Verification"]
            class SigVerification subBoxStyle
            GetIx["Get Previous Instruction"]
            CheckProgram["Verify Ed25519 Program ID"]

            %% Offset Validation
            subgraph ValidateOffsets["Offset Validation"]
                class ValidateOffsets lighterBoxStyle
                PK["Public Key Offset"]
                Sig["Signature Offset"]
                Msg["Message Data Offset"]
            end

            %% Data Validation
            subgraph DataValidation["Data Validation"]
                class DataValidation lighterBoxStyle
                Indexes["Validate Instruction Indexes"]
                Size["Validate Data Size"]
            end
        end

        %% Program Accounts
        subgraph Accounts["Program Accounts"]
            class Accounts subBoxStyle
            EA["Escrow Account (PDA) - unlock price - escrow amount"]
        end

        %% Withdrawal Conditions
        subgraph WithdrawConditions["Withdrawal Conditions"]
            class WithdrawConditions subBoxStyle
            Price["Price > unlock price"]
            Feed["Switchboard Feed"]
            Checks["Feed Validation - Staleness < 5min - Confidence Interval"]

            %% Fallback Conditions
            subgraph FallbackConditions["Fallback Conditions"]
                class FallbackConditions lighterBoxStyle
                Stale["Feed Age > 24h"]
                Zero["Feed Account = 0 Lamports"]
            end
        end
    end

    %% Flow Connections
    Deposit --> GetIx
    Withdraw --> GetIx
    GetIx --> CheckProgram
    CheckProgram --> ValidateOffsets
    ValidateOffsets --> DataValidation
    DataValidation --> EA

    EA --> WithdrawConditions
    Feed --> Price
    Price --> Checks
    Stale --> EA
    Zero --> EA
    Checks --> EA

    %% Apply Styles
    class Deposit,Withdraw boxStyle;
    class GetIx,CheckProgram subBoxStyle;
    class PK,Sig,Msg,Indexes,Size lighterBoxStyle;
    class EA subBoxStyle;
    class Price,Feed,Checks subBoxStyle;
    class Stale,Zero lighterBoxStyle;

```

