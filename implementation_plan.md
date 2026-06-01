# Implementation Plan: Add Clear Separation for Thinking Blocks

## Steps

1. Update system prompt to instruct agent to use a delimiter ('---RESPONSE-START---') to separate internal reasoning from final answer, and to always use 'thinking' field. [COMPLETED]
2. Modify main.js to detect 'thinking' field and delimiter in the 'response' field, and split content into collapsible thinking block and visible response block. [COMPLETED]
3. Update UI rendering to display thinking blocks as collapsible (like tool outputs). [ALREADY PRESENT]
4. Test the changes by running the application and ensuring proper display. [PENDING]