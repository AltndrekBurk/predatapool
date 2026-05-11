 Account Constraints ((e,t,r,a,n,i,o,s)=>{let l=document.documentElement,d=["light","dark"];function c(t){(Array.isArray(e)?e:[e]).forEach(e=>{let r="class"===e,a=r&&i?n.map(e=>i[e]||e):n;r?(l.classList.remove(...a),l.classList.add(i&&i[t]?i[t]:t)):l.setAttribute(e,t)}),s&&d.includes(t)&&(l.style.colorScheme=t)}if(a)c(a);else try{let e=localStorage.getItem(t)||r,a=o&&"system"===e?window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light":e;c(a)}catch(e){}})("class","theme","system",null,["light","dark"],null,true,true) Anchor Docs [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} Github Discord Stack Exchange Getting Started Installation Quickstart Solana Playground Local Development Core Concepts The Basics Program Structure Program IDL File Program Derived Address Cross Program Invocation Client Libraries TypeScript Rust Testing Libraries LiteSVM Mollusk Additional Features Dependency Free Composability Custom Errors Emit Events Zero Copy Footguns SPL Tokens Interacting with Tokens Basics Extensions References Program Development Account Types Account Constraints Anchor.toml Configuration Anchor CLI Anchor Version Manager Account Space Rust to JS Type Conversion Verifiable Builds Sealevel Attacks Example Programs Anchor Project Updates Release Notes Changelog Contribution Guide Search ⌘ K Anchor Docs Github Discord Stack Exchange On this page Program Development Account Constraints Anchor Account Constraints Examples Minimal reference examples for Anchor account
 constraints . 
 See the account constraints
 source code 
for implementation details. 
 Normal Constraints 
 #[account(signer)] 
 Description: Checks the given account signed the transaction. Consider using the
Signer type if you would only have this constraint on the account. 
 Examples: Github 
|
 Solpg 
 attribute [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} #[account(signer)] 
 #[account(signer @ &lt;custom_error&gt;)] 
 #[account(mut)] 
 Description: Checks the given account is mutable. Makes anchor persist any state
changes. 
 Examples: Github 
|
 Solpg 
 attribute [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} #[account( mut )] 
 #[account( mut @ &lt;custom_error&gt;)] 
 #[account(dup)] 
 Description: By default, Anchor prevents duplicate mutable accounts to avoid
potential security issues and unintended behavior. The dup constraint
explicitly allows this for cases where it&#x27;s intentional and safe. 
 Note : This constraint only applies to mutable account ( mut ) types that
serialize on exit. Other types like UncheckedAccount , Signer ,
 SystemAccount , AccountLoader , Program , and Interface naturally allow
duplicates as they don&#x27;t serialize data on exit. 
 attribute [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} #[account( mut , dup)] 
 #[account( mut , dup @ &lt;custom_error&gt;)] 
 snippet [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} #[derive( Accounts )] 
 pub struct AllowsDuplicateMutable &lt;&#x27; info &gt; { 
 #[account( mut )] 
 pub account1 : Account &lt;&#x27; info , Counter &gt;, 
 // This account can be the same as account1 
 #[account( mut , dup)] 
 pub account2 : Account &lt;&#x27; info , Counter &gt;, 
 } 
 
 pub fn allows_duplicate_mutable (ctx : Context &lt; AllowsDuplicateMutable &gt;) -&gt; Result &lt;()&gt; { 
 Ok (()) 
 } 
 #[account(init)] 
 Description: Creates the account via a CPI to the system program and initializes
it (sets its account discriminator). 
 Examples: Github 
|
 Solpg 
 attribute [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} #[account( 
 init, 
 payer = &lt;target_account&gt;, 
 space = &lt;num_bytes&gt; 
 )] 
 #[account(init_if_needed)] 
 Description: Same as init but only runs if the account does not exist yet.
Requires init-if-needed cargo feature. 
 Examples: Github 
|
 Solpg 
 attribute [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} #[account( 
 init_if_needed, 
 payer = &lt;target_account&gt; 
 )] 
 
 #[account( 
 init_if_needed, 
 payer = &lt;target_account&gt;, 
 space = &lt;num_bytes&gt; 
 )] 
 #[account(seeds, bump)] 
 Description: Checks that given account is a PDA derived from the currently
executing program, the seeds, and if provided, the bump. 
 Examples: Github 
|
 Solpg 
 attribute [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} #[account( 
 seeds = &lt;seeds&gt;, 
 bump 
 )] 
 
 #[account( 
 seeds = &lt;seeds&gt;, 
 bump, 
 seeds :: program = &lt;expr&gt; 
 )] 
 
 #[account( 
 seeds = &lt;seeds&gt;, 
 bump = &lt;expr&gt; 
 )] 
 
 #[account( 
 seeds = &lt;seeds&gt;, 
 bump = &lt;expr&gt;, 
 seeds :: program = &lt;expr&gt; 
 )] 
 #[account(has_one = target)] 
 Description: Checks the target field on the account matches the key of the
target field in the Accounts struct. 
 Examples: Github 
|
 Solpg 
 attribute [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} #[account( 
 has_one = &lt;target_account&gt; 
 )] 
 
 #[account( 
 has_one = &lt;target_account&gt; @ &lt;custom_error&gt; 
 )] 
 #[account(address = expr)] 
 Description: Checks the account key matches the pubkey. 
 Examples: Github 
|
 Solpg 
 attribute [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} #[account(address = &lt;expr&gt;)] 
 #[account(address = &lt;expr&gt; @ &lt;custom_error&gt;)] 
 #[account(owner = expr)] 
 Description: Checks the account owner matches expr. 
 Examples: Github 
|
 Solpg 
 attribute [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} #[account(owner = &lt;expr&gt;)] 
 #[account(owner = &lt;expr&gt; @ &lt;custom_error&gt;)] 
 #[account(executable)] 
 Description: Checks the account is executable (i.e. the account is a program). 
 Examples: Github 
|
 Solpg 
 attribute [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} #[account(executable)] 
 #[account(zero)] 
 Description: Checks the account discriminator is zero. Use for accounts larger
than 10 Kibibyte. 
 Examples: Github 
|
 Solpg 
 attribute [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} #[account(zero)] 
 #[account(close = target)] 
 Description: Closes the account by sending lamports to target and resetting
data. 
 Examples: Github 
|
 Solpg 
 attribute [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} #[account(close = &lt;target_account&gt;)] 
 #[account(constraint = expr)] 
 Description: Custom constraint that checks whether the given expression
evaluates to true. 
 Examples: Github 
|
 Solpg 
 attribute [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} #[account(constraint = &lt;expr&gt;)] 
 #[account( 
 constraint = &lt;expr&gt; @ &lt;custom_error&gt; 
 )] 
 #[account(realloc)] 
 Description: Used to realloc program account space at the beginning of an
instruction.
Examples: Github 
|
 Solpg 
 attribute [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} #[account( 
 realloc = &lt;space&gt;, 
 realloc :: payer = &lt;target&gt;, 
 realloc :: zero = &lt; bool &gt; 
 )] 
 #[account(discriminator = discrim)] 
 Description: Used to override the discriminator for an account. All constant expressions are supported,
but all-zero discriminators are not. 
 In versions of Anchor before 1.0, program-owned accounts with zeroed discriminators (for example, by manually
initializing an AccountInfo , or as preparation for #[zero] initialization) can be taken over via IDL instructions. 
 attribute [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} #[account(discriminator = 12)] 
 #[account(discriminator = [1, 2, 3, 4])] 
 #[account(discriminator = MY_CONST_DISCRIMINATOR )] 
 SPL Constraints 
 #[account(token::*)] 
 Description: Create or validate token accounts with specified mint and
authority. 
 Examples: Github 
|
 Solpg 
 attribute [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} #[account( 
 token :: mint = &lt;target_account&gt;, 
 token :: authority = &lt;target_account&gt; 
 )] 
 
 #[account( 
 token :: mint = &lt;target_account&gt;, 
 token :: authority = &lt;target_account&gt;, 
 token :: token_program = &lt;target_account&gt; 
 )] 
 #[account(mint::*)] 
 Description: Create or validate mint accounts with specified parameters.
Examples: Github 
|
 Solpg 
 attribute [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} #[account( 
 mint :: authority = &lt;target_account&gt;, 
 mint :: decimals = &lt;expr&gt; 
 )] 
 
 #[account( 
 mint :: authority = &lt;target_account&gt;, 
 mint :: decimals = &lt;expr&gt;, 
 mint :: freeze_authority = &lt;target_account&gt; 
 )] 
 #[account(associated_token::*)] 
 Description: Create or validate associated token accounts. 
 Examples: Github 
|
 Solpg 
 attribute [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} #[account( 
 associated_token :: mint = &lt;target_account&gt;, 
 associated_token :: authority = &lt;target_account&gt; 
 )] 
 
 #[account( 
 associated_token :: mint = &lt;target_account&gt;, 
 associated_token :: authority = &lt;target_account&gt;, 
 associated_token :: token_program = &lt;target_account&gt; 
 )] 
 #[account(*::token_program = expr)] 
 Description: The token_program can optionally be overridden. 
 Examples: Github 
|
 Solpg 
 attribute [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} #[account( *:: token_program = &lt;target_account&gt;)] 
 Token Extensions Constraints 
 #[account(extensions::close_authority::*)] 
 Description: Create or validate close authority extension on the mint account. 
 attribute [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} #[account( 
 extensions :: close_authority :: authority = &lt;target_account&gt; 
 )] 
 #[account(extensions::permanent_delegate::*)] 
 Description: Create or validate permanent delegate extension on the mint
account. 
 attribute [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} #[account( 
 extensions :: permanent_delegate :: delegate = &lt;target_account&gt; 
 )] 
 #[account(extensions::transfer_hook::*)] 
 Description: Create or validate transfer hook extension on the mint account. 
 attribute [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} #[account( 
 extensions :: transfer_hook :: authority = &lt;target_account&gt;, 
 extensions :: transfer_hook :: program_id = &lt;target_account&gt; 
 )] 
 #[account(extensions::group_pointer::*)] 
 Description: Create or validate group pointer extension on the mint account. 
 attribute [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} #[account( 
 extensions :: group_pointer :: authority = &lt;target_account&gt;, 
 extensions :: group_pointer :: group_address = &lt;target_account&gt; 
 )] 
 #[account(extensions::group_member_pointer::*)] 
 Description: Create or validate group member pointer extension on the mint
account. 
 attribute [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} #[account( 
 extensions :: group_member_pointer :: authority = &lt;target_account&gt;, 
 extensions :: group_member_pointer :: member_address = &lt;target_account&gt; 
 )] 
 #[account(extensions::metadata_pointer::*)] 
 Description: Create or validate metadata pointer extension on the mint account. 
 attribute [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} #[account( 
 extensions :: metadata_pointer :: authority = &lt;target_account&gt;, 
 extensions :: metadata_pointer :: metadata_address = &lt;target_account&gt; 
 )] 
 Instruction Attribute 
 #[instruction(...)] 
 Description: You can access the instruction&#x27;s arguments with the
 #[instruction(..)] attribute. You must list them in the same order as in the
instruction handler but you can omit all arguments after the last one you need.
Skipping arguments will result in an error. 
 Examples:
 Github 
|
 Solpg 
 snippet [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} 
 #[program] 
 pub mod example { 
 use super ::* ; 
 
 pub fn initialize (ctx : Context &lt; Initialize &gt;, input : String ) -&gt; Result &lt;()&gt; { 
 // --snip-- 
 } 
 } 
 
 #[derive( Accounts )] 
 
 #[instruction( input : String )] 
 pub struct Initialize &lt;&#x27; info &gt; { 
 #[account( 
 init, 
 payer = signer, 
 space = 8 + 4 + input . len(), 
 )] 
 pub new_account : Account &lt;&#x27; info , DataAccount &gt;, 
 // --snip-- 
 } 
 Valid Usage: 
 snippet [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} 
 
 #[program] 
 pub mod example { 
 use super ::* ; 
 
 pub fn initialize (ctx : Context &lt; Initialize &gt;, input_one : String , input_two : String ) -&gt; Result &lt;()&gt; { 
 // --snip-- 
 } 
 } 
 
 #[derive( Accounts )] 
 
 #[instruction( input_one : String , input_two : String )] 
 pub struct Initialize &lt;&#x27; info &gt; { 
 // --snip-- 
 } 
 snippet [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} 
 #[program] 
 pub mod example { 
 use super ::* ; 
 
 pub fn initialize (ctx : Context &lt; Initialize &gt;, input_one : String , input_two : String ) -&gt; Result &lt;()&gt; { 
 // --snip-- 
 } 
 } 
 
 #[derive( Accounts )] 
 
 #[instruction( input_one : String )] 
 pub struct Initialize &lt;&#x27; info &gt; { 
 // --snip-- 
 } 
 Invalid Usage, will result in an error: 
 snippet [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} 
 #[program] 
 pub mod example { 
 use super ::* ; 
 
 pub fn initialize (ctx : Context &lt; Initialize &gt;, input_one : String , input_two : String ) -&gt; Result &lt;()&gt; { 
 // --snip-- 
 } 
 } 
 
 #[derive( Accounts )] 
 
 #[instruction( input_two : String )] 
 pub struct Initialize &lt;&#x27; info &gt; { 
 // --snip-- 
 } Previous Account Types Next Anchor.toml Configuration On this page [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} Normal Constraints #[account(signer)] #[account(mut)] #[account(dup)] #[account(init)] #[account(init_if_needed)] #[account(seeds, bump)] #[account(has_one = target)] #[account(address = expr)] #[account(owner = expr)] #[account(executable)] #[account(zero)] #[account(close = target)] #[account(constraint = expr)] #[account(realloc)] #[account(discriminator = discrim)] SPL Constraints #[account(token::*)] #[account(mint::*)] #[account(associated_token::*)] #[account(*::token_program = expr)] Token Extensions Constraints #[account(extensions::close_authority::*)] #[account(extensions::permanent_delegate::*)] #[account(extensions::transfer_hook::*)] #[account(extensions::group_pointer::*)] #[account(extensions::group_member_pointer::*)] #[account(extensions::metadata_pointer::*)] Instruction Attribute #[instruction(...)] Edit on GitHub (self.__next_f=self.__next_f||[]).push([0]) self.__next_f.push([1,"1:\"$Sreact.fragment\"\n2:I[91304,[\"759\",\"static/chunks/2c5e6005-267316733e994445.js\",\"633\",\"static/chunks/af7fa4b1-c4518d43de1d15e9.js\",\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"467\",\"static/chunks/467-a5f692dccba4c00c.js\",\"177\",\"static/chunks/app/layout-f4b6be9160f5dd3f.js\"],\"Provider\"]\n3:I[47037,[],\"\"]\n4:I[10985,[],\"\"]\n5:I[32969,[\"759\",\"static/chunks/2c5e6005-267316733e994445.js\",\"633\",\"static/chunks/af7fa4b1-c4518d43de1d15e9.js\",\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"467\",\"static/chunks/467-a5f692dccba4c00c.js\",\"177\",\"static/chunks/app/layout-f4b6be9160f5dd3f.js\"],\"InkeepChatButton\"]\n6:I[50428,[\"759\",\"static/chunks/2c5e6005-267316733e994445.js\",\"633\",\"static/chunks/af7fa4b1-c4518d43de1d15e9.js\",\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"467\",\"static/chunks/467-a5f692dccba4c00c.js\",\"177\",\"static/chunks/app/layout-f4b6be9160f5dd3f.js\"],\"GoogleAnalytics\"]\n7:I[81739,[\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79a.js\",\"499\",\"static/chunks/app/docs/layout-01caae8912401cce.js\"],\"TreeContextProvider\"]\n8:I[57631,[\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79a.js\",\"499\",\"static/chunks/app/docs/layout-01caae8912401cce.js\"],\"NavProvider\"]\n9:I[39956,[\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79a.js\",\"499\",\"sta"]) self.__next_f.push([1,"tic/chunks/app/docs/layout-01caae8912401cce.js\"],\"LayoutBody\"]\na:I[83465,[\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79a.js\",\"499\",\"static/chunks/app/docs/layout-01caae8912401cce.js\"],\"CollapsibleSidebar\"]\nb:I[83465,[\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79a.js\",\"499\",\"static/chunks/app/docs/layout-01caae8912401cce.js\"],\"SidebarHeader\"]\nc:I[25424,[\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79a.js\",\"453\",\"static/chunks/453-5078e431c3a703b9.js\",\"870\",\"static/chunks/app/docs/%5B%5B...slug%5D%5D/page-75e77e2988490e7c.js\"],\"*\"]\nd:I[42617,[\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79a.js\",\"453\",\"static/chunks/453-5078e431c3a703b9.js\",\"870\",\"static/chunks/app/docs/%5B%5B...slug%5D%5D/page-75e77e2988490e7c.js\"],\"Image\"]\ne:I[83465,[\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79a.js\",\"499\",\"static/chunks/app/docs/layout-01caae8912401cce.js\"],\"SidebarCollapseTrigger\"]\nf:I[83465,[\"852\",\"static/chunks/852-77189591d9ed"]) self.__next_f.push([1,"a5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79a.js\",\"499\",\"static/chunks/app/docs/layout-01caae8912401cce.js\"],\"SidebarViewport\"]\n10:I[83465,[\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79a.js\",\"499\",\"static/chunks/app/docs/layout-01caae8912401cce.js\"],\"SidebarItem\"]\n12:I[83465,[\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79a.js\",\"499\",\"static/chunks/app/docs/layout-01caae8912401cce.js\"],\"SidebarPageTree\"]\n13:I[83465,[\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79a.js\",\"499\",\"static/chunks/app/docs/layout-01caae8912401cce.js\"],\"SidebarFooter\"]\n14:I[96292,[\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79a.js\",\"499\",\"static/chunks/app/docs/layout-01caae8912401cce.js\"],\"Navbar\"]\n15:I[99271,[\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79"]) self.__next_f.push([1,"a.js\",\"499\",\"static/chunks/app/docs/layout-01caae8912401cce.js\"],\"SearchOnly\"]\n16:I[84429,[\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79a.js\",\"499\",\"static/chunks/app/docs/layout-01caae8912401cce.js\"],\"LargeSearchToggle\"]\n17:I[57631,[\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79a.js\",\"499\",\"static/chunks/app/docs/layout-01caae8912401cce.js\"],\"Title\"]\n18:I[35999,[\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79a.js\",\"499\",\"static/chunks/app/docs/layout-01caae8912401cce.js\"],\"BaseLinkItem\"]\n19:I[84429,[\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79a.js\",\"499\",\"static/chunks/app/docs/layout-01caae8912401cce.js\"],\"SearchToggle\"]\n1a:I[96292,[\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79a.js\",\"499\",\"static/chunks/app/docs/layout-01caae8912401cce.js\"],\"NavbarSidebarTrigger\"]\n1b:I[59696,[\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js"]) self.__next_f.push([1,"\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79a.js\",\"499\",\"static/chunks/app/docs/layout-01caae8912401cce.js\"],\"ThemeToggle\"]\n1d:I[91490,[],\"OutletBoundary\"]\n1f:I[91490,[],\"MetadataBoundary\"]\n21:I[91490,[],\"ViewportBoundary\"]\n23:I[35908,[],\"\"]\n:HL[\"/_next/static/media/e4af272ccee01ff0-s.p.woff2\",\"font\",{\"crossOrigin\":\"\",\"type\":\"font/woff2\"}]\n:HL[\"/_next/static/css/1458ac26ef576a22.css\",\"style\"]\n:HL[\"/_next/static/css/9051a829e9486f68.css\",\"style\"]\n11:T403,M20.317 4.37a19.8 19.8 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.3 18.3 0 0 0-5.487 0 13 13 0 0 0-.617-1.25.08.08 0 0 0-.079-.037A19.7 19.7 0 0 0 3.677 4.37a.1.1 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.08.08 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.08.08 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13 13 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10 10 0 0 0 .372-.292.07.07 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.07.07 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.08.08 0 0 0 .084.028 19.8 19.8 0 0 0 6.002-3.03.08.08 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 0 0-.031-.03M8.02 15.33c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418m7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418"]) self.__next_f.push([1,"0:{\"P\":null,\"b\":\"CZIS05IJrNXRMEfoEJ5u5\",\"p\":\"\",\"c\":[\"\",\"docs\",\"references\",\"account-constraints\"],\"i\":false,\"f\":[[[\"\",{\"children\":[\"docs\",{\"children\":[[\"slug\",\"references/account-constraints\",\"oc\"],{\"children\":[\"__PAGE__\",{}]}]}]},\"$undefined\",\"$undefined\",true],[\"\",[\"$\",\"$1\",\"c\",{\"children\":[[[\"$\",\"link\",\"0\",{\"rel\":\"stylesheet\",\"href\":\"/_next/static/css/1458ac26ef576a22.css\",\"precedence\":\"next\",\"crossOrigin\":\"$undefined\",\"nonce\":\"$undefined\"}]],[\"$\",\"html\",null,{\"lang\":\"en\",\"className\":\"__className_f367f3\",\"suppressHydrationWarning\":true,\"children\":[[\"$\",\"body\",null,{\"className\":\"flex flex-col min-h-screen\",\"children\":[[\"$\",\"$L2\",null,{\"children\":[\"$\",\"$L3\",null,{\"parallelRouterKey\":\"children\",\"segmentPath\":[\"children\"],\"error\":\"$undefined\",\"errorStyles\":\"$undefined\",\"errorScripts\":\"$undefined\",\"template\":[\"$\",\"$L4\",null,{}],\"templateStyles\":\"$undefined\",\"templateScripts\":\"$undefined\",\"notFound\":[[],[[\"$\",\"title\",null,{\"children\":\"404: This page could not be found.\"}],[\"$\",\"div\",null,{\"style\":{\"fontFamily\":\"system-ui,\\\"Segoe UI\\\",Roboto,Helvetica,Arial,sans-serif,\\\"Apple Color Emoji\\\",\\\"Segoe UI Emoji\\\"\",\"height\":\"100vh\",\"textAlign\":\"center\",\"display\":\"flex\",\"flexDirection\":\"column\",\"alignItems\":\"center\",\"justifyContent\":\"center\"},\"children\":[\"$\",\"div\",null,{\"children\":[[\"$\",\"style\",null,{\"dangerouslySetInnerHTML\":{\"__html\":\"body{color:#000;background:#fff;margin:0}.next-error-h1{border-right:1px solid rgba(0,0,0,.3)}@media (prefers-color-scheme:dark){body{color:#fff;background:#000}.next-error-h1{border-right:1px solid rgba(255,255,255,.3)}}\"}}],[\"$\",\"h1\",null,{\"className\":\"next-error-h1\",\"style\":{\"display\":\"inline-block\",\"margin\":\"0 20px 0 0\",\"padding\":\"0 23px 0 0\",\"fontSize\":24,\"fontWeight\":500,\"verticalAlign\":\"top\",\"lineHeight\":\"49px\"},\"children\":404}],[\"$\",\"div\",null,{\"style\":{\"display\":\"inline-block\"},\"children\":[\"$\",\"h2\",null,{\"style\":{\"fontSize\":14,\"fontWeight\":400,\"lineHeight\":\"49px\",\"margin\":0},\"children\":\"This page could not be found.\"}]}]]}]}]]],\"forbidden\":\"$undefined\",\"unauthorized\":\"$undefined\"}]}],[\"$\",\"$L5\",null,{}]]}],[\"$\",\"$L6\",null,{\"gaId\":\"G-ZJYNM2WNM0\"}]]}]]}],{\"children\":[\"docs\",[\"$\",\"$1\",\"c\",{\"children\":[null,[\"$\",\"$L7\",null,{\"tree\":{\"name\":\"docs\",\"children\":[{\"type\":\"separator\",\"name\":\"Getting Started\"},{\"type\":\"page\",\"name\":\"Installation\",\"url\":\"/docs/installation\",\"$ref\":{\"file\":\"installation.mdx\"}},{\"type\":\"folder\",\"name\":\"Quickstart\",\"index\":{\"type\":\"page\",\"name\":\"Quickstart\",\"url\":\"/docs/quickstart\",\"$ref\":{\"file\":\"quickstart/index.mdx\"}},\"children\":[{\"type\":\"page\",\"name\":\"Solana Playground\",\"url\":\"/docs/quickstart/solpg\",\"$ref\":{\"file\":\"quickstart/solpg.mdx\"}},{\"type\":\"page\",\"name\":\"Local Development\",\"url\":\"/docs/quickstart/local\",\"$ref\":{\"file\":\"quickstart/local.mdx\"}}],\"$ref\":{\"metaFile\":\"quickstart/meta.json\"}},{\"type\":\"separator\",\"name\":\"Core Concepts\"},{\"type\":\"folder\",\"name\":\"The Basics\",\"index\":{\"type\":\"page\",\"name\":\"Anchor Framework Basics\",\"url\":\"/docs/basics\",\"$ref\":{\"file\":\"basics/index.mdx\"}},\"children\":[{\"type\":\"page\",\"name\":\"Program Structure\",\"url\":\"/docs/basics/program-structure\",\"$ref\":{\"file\":\"basics/program-structure.mdx\"}},{\"type\":\"page\",\"name\":\"Program IDL File\",\"url\":\"/docs/basics/idl\",\"$ref\":{\"file\":\"basics/idl.mdx\"}},{\"type\":\"page\",\"name\":\"Program Derived Address\",\"url\":\"/docs/basics/pda\",\"$ref\":{\"file\":\"basics/pda.mdx\"}},{\"type\":\"page\",\"name\":\"Cross Program Invocation\",\"url\":\"/docs/basics/cpi\",\"$ref\":{\"file\":\"basics/cpi.mdx\"}}],\"$ref\":{\"metaFile\":\"basics/meta.json\"}},{\"type\":\"folder\",\"name\":\"Client Libraries\",\"index\":{\"type\":\"page\",\"name\":\"Clients\",\"url\":\"/docs/clients\",\"$ref\":{\"file\":\"clients/index.mdx\"}},\"children\":[{\"type\":\"page\",\"name\":\"TypeScript\",\"url\":\"/docs/clients/typescript\",\"$ref\":{\"file\":\"clients/typescript.mdx\"}},{\"type\":\"page\",\"name\":\"Rust\",\"url\":\"/docs/clients/rust\",\"$ref\":{\"file\":\"clients/rust.mdx\"}}],\"$ref\":{\"metaFile\":\"clients/meta.json\"}},{\"type\":\"folder\",\"name\":\"Testing Libraries\",\"index\":{\"type\":\"page\",\"name\":\"Testing\",\"url\":\"/docs/testing\",\"$ref\":{\"file\":\"testing/index.mdx\"}},\"children\":[{\"type\":\"page\",\"name\":\"LiteSVM\",\"url\":\"/docs/testing/litesvm\",\"$ref\":{\"file\":\"testing/litesvm.mdx\"}},{\"type\":\"page\",\"name\":\"Mollusk\",\"url\":\"/docs/testing/mollusk\",\"$ref\":{\"file\":\"testing/mollusk.mdx\"}}],\"$ref\":{\"metaFile\":\"testing/meta.json\"}},{\"type\":\"folder\",\"name\":\"Additional Features\",\"index\":{\"type\":\"page\",\"name\":\"Features\",\"url\":\"/docs/features\",\"$ref\":{\"file\":\"features/index.mdx\"}},\"children\":[{\"type\":\"page\",\"name\":\"Dependency Free Composability\",\"url\":\"/docs/features/declare-program\",\"$ref\":{\"file\":\"features/declare-program.mdx\"}},{\"type\":\"page\",\"name\":\"Custom Errors\",\"url\":\"/docs/features/errors\",\"$ref\":{\"file\":\"features/errors.mdx\"}},{\"type\":\"page\",\"name\":\"Emit Events\",\"url\":\"/docs/features/events\",\"$ref\":{\"file\":\"features/events.mdx\"}},{\"type\":\"page\",\"name\":\"Zero Copy\",\"url\":\"/docs/features/zero-copy\",\"$ref\":{\"file\":\"features/zero-copy.mdx\"}}],\"$ref\":{\"metaFile\":\"features/meta.json\"}},{\"type\":\"page\",\"name\":\"Footguns\",\"url\":\"/docs/footguns\",\"$ref\":{\"file\":\"footguns.mdx\"}},{\"type\":\"separator\",\"name\":\"SPL Tokens\"},{\"type\":\"folder\",\"name\":\"Interacting with Tokens\",\"index\":{\"type\":\"page\",\"name\":\"Token Integration with Anchor\",\"url\":\"/docs/tokens\",\"$ref\":{\"file\":\"tokens/index.mdx\"}},\"children\":[{\"type\":\"folder\",\"name\":\"Basics\",\"index\":{\"type\":\"page\",\"name\":\"SPL Token Basics\",\"url\":\"/docs/tokens/basics\",\"$ref\":{\"file\":\"tokens/basics/index.mdx\"}},\"children\":[{\"type\":\"page\",\"name\":\"Create a Token Mint\",\"url\":\"/docs/tokens/basics/create-mint\",\"$ref\":{\"file\":\"tokens/basics/create-mint.mdx\"}},{\"type\":\"page\",\"name\":\"Create a Token Account\",\"url\":\"/docs/tokens/basics/create-token-account\",\"$ref\":{\"file\":\"tokens/basics/create-token-account.mdx\"}},{\"type\":\"page\",\"name\":\"Mint Tokens\",\"url\":\"/docs/tokens/basics/mint-tokens\",\"$ref\":{\"file\":\"tokens/basics/mint-tokens.mdx\"}},{\"type\":\"page\",\"name\":\"Transfer Tokens\",\"url\":\"/docs/tokens/basics/transfer-tokens\",\"$ref\":{\"file\":\"tokens/basics/transfer-tokens.mdx\"}}],\"$ref\":{\"metaFile\":\"tokens/basics/meta.json\"}},{\"type\":\"page\",\"name\":\"Extensions\",\"url\":\"/docs/tokens/extensions\",\"$ref\":{\"file\":\"tokens/extensions.mdx\"}}],\"$ref\":{\"metaFile\":\"tokens/meta.json\"}},{\"type\":\"separator\",\"name\":\"References\"},{\"type\":\"folder\",\"name\":\"Program Development\",\"index\":{\"type\":\"page\",\"name\":\"Anchor References\",\"url\":\"/docs/references\",\"$ref\":{\"file\":\"references/index.mdx\"}},\"children\":[{\"type\":\"page\",\"name\":\"Account Types\",\"url\":\"/docs/references/account-types\",\"$ref\":{\"file\":\"references/account-types.mdx\"}},{\"type\":\"page\",\"name\":\"Account Constraints\",\"url\":\"/docs/references/account-constraints\",\"$ref\":{\"file\":\"references/account-constraints.mdx\"}},{\"type\":\"page\",\"name\":\"Anchor.toml Configuration\",\"url\":\"/docs/references/anchor-toml\",\"$ref\":{\"file\":\"references/anchor-toml.mdx\"}},{\"type\":\"page\",\"name\":\"Anchor CLI\",\"url\":\"/docs/references/cli\",\"$ref\":{\"file\":\"references/cli.mdx\"}},{\"type\":\"page\",\"name\":\"Anchor Version Manager\",\"url\":\"/docs/references/avm\",\"$ref\":{\"file\":\"references/avm.mdx\"}},{\"type\":\"page\",\"name\":\"Account Space\",\"url\":\"/docs/references/space\",\"$ref\":{\"file\":\"references/space.mdx\"}},{\"type\":\"page\",\"name\":\"Rust to JS Type Conversion\",\"url\":\"/docs/references/type-conversion\",\"$ref\":{\"file\":\"references/type-conversion.mdx\"}},{\"type\":\"page\",\"name\":\"Verifiable Builds\",\"url\":\"/docs/references/verifiable-builds\",\"$ref\":{\"file\":\"references/verifiable-builds.mdx\"}},{\"type\":\"page\",\"name\":\"Sealevel Attacks\",\"url\":\"/docs/references/security-exploits\",\"$ref\":{\"file\":\"references/security-exploits.mdx\"}},{\"type\":\"page\",\"name\":\"Example Programs\",\"url\":\"/docs/references/examples\",\"$ref\":{\"file\":\"references/examples.mdx\"}}],\"$ref\":{\"metaFile\":\"references/meta.json\"}},{\"type\":\"folder\",\"name\":\"Anchor Project Updates\",\"children\":[{\"type\":\"folder\",\"name\":\"Release Notes\",\"children\":[{\"type\":\"page\",\"name\":\"1.0.1\",\"url\":\"/docs/updates/release-notes/1-0-1\",\"$ref\":{\"file\":\"updates/release-notes/1-0-1.mdx\"}},{\"type\":\"page\",\"name\":\"1.0.0\",\"url\":\"/docs/updates/release-notes/1-0-0\",\"$ref\":{\"file\":\"updates/release-notes/1-0-0.mdx\"}},{\"type\":\"page\",\"name\":\"0.32.1\",\"url\":\"/docs/updates/release-notes/0-32-1\",\"$ref\":{\"file\":\"updates/release-notes/0-32-1.mdx\"}},{\"type\":\"page\",\"name\":\"0.32.0\",\"url\":\"/docs/updates/release-notes/0-32-0\",\"$ref\":{\"file\":\"updates/release-notes/0-32-0.mdx\"}},{\"type\":\"page\",\"name\":\"0.31.1\",\"url\":\"/docs/updates/release-notes/0-31-1\",\"$ref\":{\"file\":\"updates/release-notes/0-31-1.mdx\"}},{\"type\":\"page\",\"name\":\"0.31.0\",\"url\":\"/docs/updates/release-notes/0-31-0\",\"$ref\":{\"file\":\"updates/release-notes/0-31-0.mdx\"}},{\"type\":\"page\",\"name\":\"0.30.1\",\"url\":\"/docs/updates/release-notes/0-30-1\",\"$ref\":{\"file\":\"updates/release-notes/0-30-1.mdx\"}},{\"type\":\"page\",\"name\":\"0.30.0\",\"url\":\"/docs/updates/release-notes/0-30-0\",\"$ref\":{\"file\":\"updates/release-notes/0-30-0.mdx\"}},{\"type\":\"page\",\"name\":\"0.29.0\",\"url\":\"/docs/updates/release-notes/0-29-0\",\"$ref\":{\"file\":\"updates/release-notes/0-29-0.mdx\"}}],\"$ref\":{\"metaFile\":\"updates/release-notes/meta.json\"}},{\"type\":\"page\",\"name\":\"Changelog\",\"url\":\"/docs/updates/changelog\",\"$ref\":{\"file\":\"updates/changelog.mdx\"}},{\"type\":\"page\",\"name\":\"Contribution Guide\",\"url\":\"/docs/updates/contribution-guide\",\"$ref\":{\"file\":\"updates/contribution-guide.mdx\"}}],\"$ref\":{\"metaFile\":\"updates/meta.json\"}}]},\"children\":[\"$\",\"$L8\",null,{\"transparentMode\":\"$undefined\",\"children\":[\"$\",\"$L9\",null,{\"className\":\"[--fd-nav-height:3.5rem] md:[--fd-sidebar-width:260px] lg:[--fd-toc-width:260px] [\u0026_#nd-toc]:max-lg:hidden [\u0026_#nd-tocnav]:lg:h