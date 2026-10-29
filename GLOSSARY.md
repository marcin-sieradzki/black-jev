# Black Jev

Jev, TypeSafe AI's decision model, playing Blackjack at a table that deals only while someone watches.

## Language

**Jev**:
The player at the table: TypeSafe AI's System One decision model, or the stand-in when it can't answer.
_Avoid_: bot, agent, AI

**Stand-in**:
The local decider that plays basic strategy when there's no TypeSafe key or the API doesn't answer in time.
_Avoid_: mock, fallback strategy

**Round**:
One deal from bet to settlement, played in full on the server the moment a page asks for it.
_Avoid_: game, hand (a round can hold up to four hands)

**Hand**:
One set of Jev's cards with its own bet; a split turns one hand into two.

**Step**:
One thing a round shows: a move at the table, or a line from the dealer such as a shuffle or a rebuy.
_Avoid_: event, frame

**Move**:
A step that happens at the table: a bet, a card, a decision, the reveal, the settlement.

**Playback**:
What a round shows at a moment on the server's clock; every page plays the same round back on the same clock.
_Avoid_: replay, animation

**Rebuy**:
Jev buying back in with the starting bankroll when it can't cover the bet.

**Table record**:
What survives between requests: Jev's state, the shoe and the round being shown.
_Avoid_: session, save
