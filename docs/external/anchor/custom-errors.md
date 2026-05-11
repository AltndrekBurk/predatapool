 Custom Errors ((e,t,r,a,n,i,o,s)=>{let l=document.documentElement,d=["light","dark"];function c(t){(Array.isArray(e)?e:[e]).forEach(e=>{let r="class"===e,a=r&&i?n.map(e=>i[e]||e):n;r?(l.classList.remove(...a),l.classList.add(i&&i[t]?i[t]:t)):l.setAttribute(e,t)}),s&&d.includes(t)&&(l.style.colorScheme=t)}if(a)c(a);else try{let e=localStorage.getItem(t)||r,a=o&&"system"===e?window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light":e;c(a)}catch(e){}})("class","theme","system",null,["light","dark"],null,true,true) Anchor Docs [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} Github Discord Stack Exchange Getting Started Installation Quickstart Solana Playground Local Development Core Concepts The Basics Program Structure Program IDL File Program Derived Address Cross Program Invocation Client Libraries TypeScript Rust Testing Libraries LiteSVM Mollusk Additional Features Dependency Free Composability Custom Errors Emit Events Zero Copy Footguns SPL Tokens Interacting with Tokens Basics Extensions References Program Development Account Types Account Constraints Anchor.toml Configuration Anchor CLI Anchor Version Manager Account Space Rust to JS Type Conversion Verifiable Builds Sealevel Attacks Example Programs Anchor Project Updates Release Notes Changelog Contribution Guide Search ⌘ K Anchor Docs Github Discord Stack Exchange On this page Additional Features Custom Errors Learn how to implement custom error handling in Anchor programs. All instruction handlers in Anchor programs return a custom Result&lt;T&gt; type
that allows you to handle successful execution with Ok(T) and error cases with
 Err(Error) . 
 [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} 
 pub fn custom_instruction (ctx : Context &lt; CustomInstruction &gt;) -&gt; Result &lt;()&gt; { 
 // --snip-- 
 Ok (()) 
 } 
 The
 Result&lt;T&gt; 
type in Anchor programs is a type alias that wraps the standard Rust
 Result&lt;T, E&gt; . In this case, T represents the successful return type, while
 E is Anchor&#x27;s custom Error type. 
 [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} pub type Result &lt; T &gt; = std :: result :: Result &lt; T , error :: Error &gt;; 
 Anchor Error 
 When an error occurs in an Anchor program, it returns a custom
 Error 
type defined as: 
 [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} #[derive( Debug , PartialEq , Eq )] 
 pub enum Error { 
 AnchorError ( Box &lt; AnchorError &gt;), 
 ProgramError ( Box &lt; ProgramErrorWithOrigin &gt;), 
 } 
 The Error type in Anchor programs can be one of two variants: 
 
 ProgramErrorWithOrigin :
Custom type that wraps a standard Solana
 ProgramError 
type. These errors come from the solana_program crate. 
 
 [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} #[derive( Debug )] 
 pub struct ProgramErrorWithOrigin { 
 pub program_error : ProgramError , 
 pub error_origin : Option &lt; ErrorOrigin &gt;, 
 pub compared_values : Option &lt; ComparedValues &gt;, 
 } 
 
 AnchorError :
Errors defined by the Anchor framework. 
 
 [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} #[derive( Debug )] 
 pub struct AnchorError { 
 pub error_name : String , 
 pub error_code_number : u32 , 
 pub error_msg : String , 
 pub error_origin : Option &lt; ErrorOrigin &gt;, 
 pub compared_values : Option &lt; ComparedValues &gt;, 
 } 
 An AnchorError can be thought of as having two categories: 

 Internal Anchor Errors - These are built-in errors included with the Anchor
framework. They are defined in the
 ErrorCode 
enum. 

 Custom Program Errors - These are program specific errors that developers
define to handle custom error cases. 

 The error_code_number from an AnchorError has the following numbering
scheme: 
 Error Code Description &gt;= 100 Instruction error codes &gt;= 1000 IDL error codes &gt;= 2000 Constraint error codes &gt;= 3000 Account error codes &gt;= 4100 Misc error codes = 5000 Deprecated error code &gt;= 6000 Starting point for custom user errors 
 Usage 
 Anchor provides a convenient way to define custom errors through the
 error_code attribute. The implementation details can be found
 here . 
 When you define an enum with the error_code attribute, Anchor automatically: 
 
 Assigns an error code starting from 6000 
 Generates the necessary boilerplate for error handling 
 Enables the use of custom error messages via the msg attribute 
 
 [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} #[error_code] 
 pub enum MyError { 
 #[msg( &quot;My custom error message&quot; )] 
 MyCustomError , 
 #[msg( &quot;My second custom error message&quot; )] 
 MySecondCustomError , 
 } 
 err! 
 To throw an error, use the
 err! 
macro. The err! macro provides a convenient way to return custom errors from
your program. Under the hood, err! uses the error! macro to construct
 AnchorError . The implementation can be found
 here . 
 [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} #[program] 
 mod hello_anchor { 
 use super ::* ; 
 pub fn set_data (ctx : Context &lt; SetData &gt;, data : MyAccount ) - Result &lt;()&gt; { 
 if data . data = 100 { 

 return err! ( MyError :: DataTooLarge ); 
 } 
 ctx . accounts . my_account . set_inner (data); 
 Ok (()) 
 } 
 } 

 #[error_code] 
 pub enum MyError { 
 #[msg( &quot;MyAccount may only hold data below 100&quot; )] 
 DataTooLarge 
 } 
 require! 
 The
 require! 
macro provides a more concise way to handle error conditions. It combines a
condition check with returning an error if the condition is false. Here&#x27;s how we
can rewrite the previous example using require! : 
 [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} #[program] 
 mod hello_anchor { 
 use super ::* ; 
 pub fn set_data (ctx : Context &lt; SetData &gt;, data : MyAccount ) - Result &lt;()&gt; { 

 require! (data . data &lt; 100 , MyError :: DataTooLarge ); 
 ctx . accounts . my_account . set_inner (data); 
 Ok (()) 
 } 
 } 

 #[error_code] 
 pub enum MyError { 
 #[msg( &quot;MyAccount may only hold data below 100&quot; )] 
 DataTooLarge 
 } 
 Anchor provides several &quot;require&quot; macros for different validation needs. You can
find the implementation of these macros
 here . 
 Macro Description require! Ensures a condition is true, otherwise returns with the given error. require_eq! Ensures two NON-PUBKEY values are equal. require_neq! Ensures two NON-PUBKEY values are not equal. require_keys_eq! Ensures two pubkeys values are equal. require_keys_neq! Ensures two pubkeys are not equal. require_gt! Ensures the first NON-PUBKEY value is greater than the second NON-PUBKEY value. require_gte! Ensures the first NON-PUBKEY value is greater than or equal to the second NON-PUBKEY value. 
 Example 
 Here&#x27;s a simple example demonstrating how to define and handle custom errors in
an Anchor program. The program below validates that an input amount falls within
an acceptable range, showing how to: 
 
 Define custom error types with messages 
 Use the require! macro to check conditions and return errors 
 
 Program Client lib.rs [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} use anchor_lang :: prelude ::* ; 
 
 declare_id! ( &quot;9oECKMeeyf1fWNPKzyrB2x1AbLjHDFjs139kEyFwBpoV&quot; ); 
 
 #[program] 
 pub mod custom_error { 
 use super ::* ; 
 
 pub fn validate_amount (_ctx : Context &lt; ValidateAmount &gt;, amount : u64 ) - Result &lt;()&gt; { 

 require! (amount &gt;= 10 , CustomError :: AmountTooSmall ); 
 require! (amount &lt;= 100 , CustomError :: AmountTooLarge ); 
 
 msg! ( &quot;Amount validated successfully: {}&quot; , amount); 
 Ok (()) 
 } 
 } 
 
 #[derive( Accounts )] 
 pub struct ValidateAmount {} 
 
 #[error_code] 
 pub enum CustomError { 
 #[msg( &quot;Amount must be greater than or equal to 10&quot; )] 
 AmountTooSmall , 
 #[msg( &quot;Amount must be less than or equal to 100&quot; )] 
 AmountTooLarge , 
 } 
 When a program error occurs, Anchor&#x27;s TypeScript Client SDK returns a detailed
 error response 
containing information about the error. Here&#x27;s an example error response showing
the structure and available fields: 
 Error Response [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} { 
 errorLogs: [ 
 &#x27;Program log: AnchorError thrown in programs/custom-error/src/lib.rs:11. Error Code: AmountTooLarge. Error Number: 6001. Error Message: Amount must be less than or equal to 100.&#x27; 
 ], 
 logs: [ 
 &#x27;Program 9oECKMeeyf1fWNPKzyrB2x1AbLjHDFjs139kEyFwBpoV invoke [1]&#x27; , 
 &#x27;Program log: Instruction: ValidateAmount&#x27; , 
 &#x27;Program log: AnchorError thrown in programs/custom-error/src/lib.rs:11. Error Code: AmountTooLarge. Error Number: 6001. Error Message: Amount must be less than or equal to 100.&#x27; , 
 &#x27;Program 9oECKMeeyf1fWNPKzyrB2x1AbLjHDFjs139kEyFwBpoV consumed 2153 of 200000 compute units&#x27; , 
 &#x27;Program 9oECKMeeyf1fWNPKzyrB2x1AbLjHDFjs139kEyFwBpoV failed: custom program error: 0x1771&#x27; 
 ], 
 error: { 
 errorCode: { code: &#x27;AmountTooLarge&#x27;, number: 6001 }, 
 errorMessage: &#x27;Amount must be less than or equal to 100&#x27;, 
 comparedValues: undefined, 
 origin: { file: &#x27;programs/custom-error/src/lib.rs&#x27;, line: 11 } 
 }, 
 _programErrorStack: ProgramErrorStack { 
 stack: [ 
 [PublicKey [PublicKey( 9 oECKMeeyf 1 fWNPKzyrB 2 x 1 AbLjHDFjs 139 kEyFwBpoV)]] 
 ] 
 } 
 } 
 For a more comprehensive example, you can also reference the
 errors test program 
in the Anchor repository. Previous Dependency Free Composability Next Emit Events On this page [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none} Anchor Error Usage err! require! Example Edit on GitHub (self.__next_f=self.__next_f||[]).push([0]) self.__next_f.push([1,"1:\"$Sreact.fragment\"\n2:I[91304,[\"759\",\"static/chunks/2c5e6005-267316733e994445.js\",\"633\",\"static/chunks/af7fa4b1-c4518d43de1d15e9.js\",\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"467\",\"static/chunks/467-a5f692dccba4c00c.js\",\"177\",\"static/chunks/app/layout-f4b6be9160f5dd3f.js\"],\"Provider\"]\n3:I[47037,[],\"\"]\n4:I[10985,[],\"\"]\n5:I[32969,[\"759\",\"static/chunks/2c5e6005-267316733e994445.js\",\"633\",\"static/chunks/af7fa4b1-c4518d43de1d15e9.js\",\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"467\",\"static/chunks/467-a5f692dccba4c00c.js\",\"177\",\"static/chunks/app/layout-f4b6be9160f5dd3f.js\"],\"InkeepChatButton\"]\n6:I[50428,[\"759\",\"static/chunks/2c5e6005-267316733e994445.js\",\"633\",\"static/chunks/af7fa4b1-c4518d43de1d15e9.js\",\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"467\",\"static/chunks/467-a5f692dccba4c00c.js\",\"177\",\"static/chunks/app/layout-f4b6be9160f5dd3f.js\"],\"GoogleAnalytics\"]\n7:I[81739,[\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79a.js\",\"499\",\"static/chunks/app/docs/layout-01caae8912401cce.js\"],\"TreeContextProvider\"]\n8:I[57631,[\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79a.js\",\"499\",\"static/chunks/app/docs/layout-01caae8912401cce.js\"],\"NavProvider\"]\n9:I[39956,[\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79a.js\",\"499\",\"sta"]) self.__next_f.push([1,"tic/chunks/app/docs/layout-01caae8912401cce.js\"],\"LayoutBody\"]\na:I[83465,[\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79a.js\",\"499\",\"static/chunks/app/docs/layout-01caae8912401cce.js\"],\"CollapsibleSidebar\"]\nb:I[83465,[\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79a.js\",\"499\",\"static/chunks/app/docs/layout-01caae8912401cce.js\"],\"SidebarHeader\"]\nc:I[25424,[\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79a.js\",\"453\",\"static/chunks/453-5078e431c3a703b9.js\",\"870\",\"static/chunks/app/docs/%5B%5B...slug%5D%5D/page-75e77e2988490e7c.js\"],\"*\"]\nd:I[42617,[\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79a.js\",\"453\",\"static/chunks/453-5078e431c3a703b9.js\",\"870\",\"static/chunks/app/docs/%5B%5B...slug%5D%5D/page-75e77e2988490e7c.js\"],\"Image\"]\ne:I[83465,[\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79a.js\",\"499\",\"static/chunks/app/docs/layout-01caae8912401cce.js\"],\"SidebarCollapseTrigger\"]\nf:I[83465,[\"852\",\"static/chunks/852-77189591d9ed"]) self.__next_f.push([1,"a5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79a.js\",\"499\",\"static/chunks/app/docs/layout-01caae8912401cce.js\"],\"SidebarViewport\"]\n10:I[83465,[\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79a.js\",\"499\",\"static/chunks/app/docs/layout-01caae8912401cce.js\"],\"SidebarItem\"]\n12:I[83465,[\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79a.js\",\"499\",\"static/chunks/app/docs/layout-01caae8912401cce.js\"],\"SidebarPageTree\"]\n13:I[83465,[\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79a.js\",\"499\",\"static/chunks/app/docs/layout-01caae8912401cce.js\"],\"SidebarFooter\"]\n14:I[96292,[\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79a.js\",\"499\",\"static/chunks/app/docs/layout-01caae8912401cce.js\"],\"Navbar\"]\n15:I[99271,[\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79"]) self.__next_f.push([1,"a.js\",\"499\",\"static/chunks/app/docs/layout-01caae8912401cce.js\"],\"SearchOnly\"]\n16:I[84429,[\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79a.js\",\"499\",\"static/chunks/app/docs/layout-01caae8912401cce.js\"],\"LargeSearchToggle\"]\n17:I[57631,[\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79a.js\",\"499\",\"static/chunks/app/docs/layout-01caae8912401cce.js\"],\"Title\"]\n18:I[35999,[\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79a.js\",\"499\",\"static/chunks/app/docs/layout-01caae8912401cce.js\"],\"BaseLinkItem\"]\n19:I[84429,[\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79a.js\",\"499\",\"static/chunks/app/docs/layout-01caae8912401cce.js\"],\"SearchToggle\"]\n1a:I[96292,[\"852\",\"static/chunks/852-77189591d9eda5a3.js\",\"314\",\"static/chunks/314-83dd9e1b596102e6.js\",\"327\",\"static/chunks/327-97de05b043917361.js\",\"424\",\"static/chunks/424-8da3c85d73f1955d.js\",\"985\",\"static/chunks/985-b316621c31d7357d.js\",\"131\",\"static/chunks/131-c6c873c96b60e79a.js\",\"499\",\"static/chunks/app/docs/layout-01caae8912401cce.js\"],\"NavbarSidebarTrigger\"]\n1b:I[59696,[\"85