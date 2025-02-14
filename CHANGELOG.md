# Change Log

All notable changes to the "eviews-language-extension" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.1.0] - 7/15/2023

- Initial release

## [0.1.1] - 7/16/2023

- Indentation and folding

## [0.2.0] - 7/27/2023

- Hover and intellisense
- Completions on reserved words and objects defined in program and includes
- Hover and some comlpetions includes links to EViews help

## [0.2.1] - 7/29/2023

 - Basic signature help

### [0.2.2] - 7/30/2023

 - Much improved signature help
 - Use dynamic snippets instead of sig help for commands
 - More appropriate completion hints based on context
 - Lots of bug fixes

 ### [0.2.3] - 8/1/2023

 - Run in EViews command

 ### [0.2.4] - 8/1/2023

 - Improved and more reliable call signature parser for signature help

 ### [0.2.5] - 8/4/2023

 - Updates for missing EViews builtins, corrected broken EViews help hyperlinks
 - Hover links to local subs
 - Parse doc strings for subroutines
 - Improved handling of mixed case definitios and filenames
 - Provide link to includes for click to open in editor
 - Provide link and line # of variable definitions

 ### [0.2.6] -- 8/8/2023

 - Bug fixes for variable case in subroutines
 - Copy cmd creates definitions
 - No "." operator hints on program vars
 
### [0.2.7] -- 4/29/2024

 - Hover provider prioritizes clashes between user symbols and EViews keywords appropriately
 - Subroutine sig helper now correctly works alongside completion hints

### [0.2.8] -- 1/3/2025

 - Support "subroutine local" [DONE]
 - Update for URL changes to EViews online help [DONE]
 - Include hover over path will resolve clickable link to path (previously only if you hovered over the include keyword) [DONE]
 - JSDOC-style docstring type definitions on the lines above referenced variables. 
 
    Examples:

    ```
        '@type table
        myTable(1,3) = @value("100")

        '@type myTable=table a=scalar d=vector
        a = d(3)

    ```

 ### [0.3.0] - FUTURE PLANS

 - Multiline support [?]
 - Errors/Problems [?]
 - Outline in Explorer View [?]
 - In-comment declarations to aid intellisense [?]
 - Completions on object element operations (e.g., comletions/sig help on myVec in "myVec(2) = 1" and "!c = myVec(2)") [?]
 - Duplicate variable/subroutine defintions [?]
