/**
 * Every shape of opening a board through pullboard.dev, in real Chromium and real WebKit [H5,H17,N26].
 *
 * Each cell is one of: where the browser is (the computer with the boards, its view running or not; another
 * computer; a phone) x the account (signed out, signed in) x this browser (paired, not paired, revoked) x the
 * boards (none linked, excluded, healthy, over the size limit, waiting for a phone approval, mixed) x what the
 * browser has stored (fresh, a stale pairing link, a stale board key). Each runs with the real CLI, a real local
 * relay, a real `pullboard view` and real browsers, and must show the board within 3 s, or name its exact blocker
 * and the one step that clears it, never a step the person already took. A cell that fails is a filed defect,
 * listed in KNOWN_DEFECTS with its item; the matrix fails on any other failing cell, and on a listed cell that now
 * passes, so the list stays true. Every cell and the screen it must reach:
 *
 * CELLS-START
 * board-view/signed-out/paired/none/fresh: the board within 3 s (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * board-view/signed-out/paired/none/stale-pairing: the board within 3 s (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * board-view/signed-out/paired/none/stale-key: the board within 3 s (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * board-view/signed-out/unpaired/none/fresh: the board within 3 s
 * board-view/signed-out/unpaired/none/stale-pairing: the board within 3 s
 * board-view/signed-out/unpaired/none/stale-key: the board within 3 s
 * board-view/signed-out/revoked/none/fresh: the board within 3 s (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * board-view/signed-out/revoked/none/stale-pairing: the board within 3 s (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * board-view/signed-out/revoked/none/stale-key: the board within 3 s (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * board-view/signed-in/paired/none/fresh: the board within 3 s (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * board-view/signed-in/paired/none/stale-pairing: the board within 3 s (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * board-view/signed-in/paired/none/stale-key: the board within 3 s (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * board-view/signed-in/unpaired/none/fresh: the board within 3 s
 * board-view/signed-in/unpaired/none/stale-pairing: the board within 3 s
 * board-view/signed-in/unpaired/none/stale-key: the board within 3 s
 * board-view/signed-in/revoked/none/fresh: the board within 3 s (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * board-view/signed-in/revoked/none/stale-pairing: the board within 3 s (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * board-view/signed-in/revoked/none/stale-key: the board within 3 s (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * board-no-view/signed-out/paired/none/fresh: names sign-in and the one step that clears it (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * board-no-view/signed-out/paired/none/stale-pairing: names sign-in and the one step that clears it (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * board-no-view/signed-out/paired/none/stale-key: names sign-in and the one step that clears it (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * board-no-view/signed-out/unpaired/none/fresh: names sign-in and the one step that clears it
 * board-no-view/signed-out/unpaired/none/stale-pairing: names sign-in and the one step that clears it
 * board-no-view/signed-out/unpaired/none/stale-key: names sign-in and the one step that clears it
 * board-no-view/signed-out/revoked/none/fresh: names sign-in and the one step that clears it (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * board-no-view/signed-out/revoked/none/stale-pairing: names sign-in and the one step that clears it (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * board-no-view/signed-out/revoked/none/stale-key: names sign-in and the one step that clears it (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * board-no-view/signed-in/paired/none/fresh: names not-linked and the one step that clears it (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * board-no-view/signed-in/paired/none/stale-pairing: names not-linked and the one step that clears it (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * board-no-view/signed-in/paired/none/stale-key: names not-linked and the one step that clears it (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * board-no-view/signed-in/unpaired/none/fresh: names not-linked and the one step that clears it
 * board-no-view/signed-in/unpaired/none/stale-pairing: names not-linked and the one step that clears it
 * board-no-view/signed-in/unpaired/none/stale-key: names not-linked and the one step that clears it
 * board-no-view/signed-in/revoked/none/fresh: names not-linked and the one step that clears it (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * board-no-view/signed-in/revoked/none/stale-pairing: names not-linked and the one step that clears it (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * board-no-view/signed-in/revoked/none/stale-key: names not-linked and the one step that clears it (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * other-computer/signed-out/paired/none/fresh: names sign-in and the one step that clears it (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * other-computer/signed-out/paired/none/stale-pairing: names sign-in and the one step that clears it (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * other-computer/signed-out/paired/none/stale-key: names sign-in and the one step that clears it (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * other-computer/signed-out/unpaired/none/fresh: names sign-in and the one step that clears it
 * other-computer/signed-out/unpaired/none/stale-pairing: names sign-in and the one step that clears it
 * other-computer/signed-out/unpaired/none/stale-key: names sign-in and the one step that clears it
 * other-computer/signed-out/revoked/none/fresh: names sign-in and the one step that clears it (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * other-computer/signed-out/revoked/none/stale-pairing: names sign-in and the one step that clears it (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * other-computer/signed-out/revoked/none/stale-key: names sign-in and the one step that clears it (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * other-computer/signed-in/paired/none/fresh: names not-linked and the one step that clears it (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * other-computer/signed-in/paired/none/stale-pairing: names not-linked and the one step that clears it (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * other-computer/signed-in/paired/none/stale-key: names not-linked and the one step that clears it (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * other-computer/signed-in/unpaired/none/fresh: names not-linked and the one step that clears it
 * other-computer/signed-in/unpaired/none/stale-pairing: names not-linked and the one step that clears it
 * other-computer/signed-in/unpaired/none/stale-key: names not-linked and the one step that clears it
 * other-computer/signed-in/revoked/none/fresh: names not-linked and the one step that clears it (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * other-computer/signed-in/revoked/none/stale-pairing: names not-linked and the one step that clears it (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * other-computer/signed-in/revoked/none/stale-key: names not-linked and the one step that clears it (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * phone/signed-out/paired/none/fresh: names sign-in and the one step that clears it (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * phone/signed-out/paired/none/stale-pairing: names sign-in and the one step that clears it (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * phone/signed-out/paired/none/stale-key: names sign-in and the one step that clears it (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * phone/signed-out/unpaired/none/fresh: names sign-in and the one step that clears it
 * phone/signed-out/unpaired/none/stale-pairing: names sign-in and the one step that clears it
 * phone/signed-out/unpaired/none/stale-key: names sign-in and the one step that clears it
 * phone/signed-out/revoked/none/fresh: names sign-in and the one step that clears it (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * phone/signed-out/revoked/none/stale-pairing: names sign-in and the one step that clears it (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * phone/signed-out/revoked/none/stale-key: names sign-in and the one step that clears it (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * phone/signed-in/paired/none/fresh: names not-linked and the one step that clears it (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * phone/signed-in/paired/none/stale-pairing: names not-linked and the one step that clears it (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * phone/signed-in/paired/none/stale-key: names not-linked and the one step that clears it (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * phone/signed-in/unpaired/none/fresh: names not-linked and the one step that clears it
 * phone/signed-in/unpaired/none/stale-pairing: names not-linked and the one step that clears it
 * phone/signed-in/unpaired/none/stale-key: names not-linked and the one step that clears it
 * phone/signed-in/revoked/none/fresh: names not-linked and the one step that clears it (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * phone/signed-in/revoked/none/stale-pairing: names not-linked and the one step that clears it (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * phone/signed-in/revoked/none/stale-key: names not-linked and the one step that clears it (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * board-view/signed-out/paired/excluded/fresh: the board within 3 s (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * board-view/signed-out/paired/excluded/stale-pairing: the board within 3 s (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * board-view/signed-out/paired/excluded/stale-key: the board within 3 s (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * board-view/signed-out/unpaired/excluded/fresh: the board within 3 s
 * board-view/signed-out/unpaired/excluded/stale-pairing: the board within 3 s
 * board-view/signed-out/unpaired/excluded/stale-key: the board within 3 s
 * board-view/signed-out/revoked/excluded/fresh: the board within 3 s (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * board-view/signed-out/revoked/excluded/stale-pairing: the board within 3 s (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * board-view/signed-out/revoked/excluded/stale-key: the board within 3 s (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * board-view/signed-in/paired/excluded/fresh: the board within 3 s (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * board-view/signed-in/paired/excluded/stale-pairing: the board within 3 s (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * board-view/signed-in/paired/excluded/stale-key: the board within 3 s (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * board-view/signed-in/unpaired/excluded/fresh: the board within 3 s
 * board-view/signed-in/unpaired/excluded/stale-pairing: the board within 3 s
 * board-view/signed-in/unpaired/excluded/stale-key: the board within 3 s
 * board-view/signed-in/revoked/excluded/fresh: the board within 3 s (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * board-view/signed-in/revoked/excluded/stale-pairing: the board within 3 s (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * board-view/signed-in/revoked/excluded/stale-key: the board within 3 s (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * board-no-view/signed-out/paired/excluded/fresh: names sign-in and the one step that clears it (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * board-no-view/signed-out/paired/excluded/stale-pairing: names sign-in and the one step that clears it (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * board-no-view/signed-out/paired/excluded/stale-key: names sign-in and the one step that clears it (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * board-no-view/signed-out/unpaired/excluded/fresh: names sign-in and the one step that clears it
 * board-no-view/signed-out/unpaired/excluded/stale-pairing: names sign-in and the one step that clears it
 * board-no-view/signed-out/unpaired/excluded/stale-key: names sign-in and the one step that clears it
 * board-no-view/signed-out/revoked/excluded/fresh: names sign-in and the one step that clears it (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * board-no-view/signed-out/revoked/excluded/stale-pairing: names sign-in and the one step that clears it (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * board-no-view/signed-out/revoked/excluded/stale-key: names sign-in and the one step that clears it (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * board-no-view/signed-in/paired/excluded/fresh: names excluded and the one step that clears it (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * board-no-view/signed-in/paired/excluded/stale-pairing: names excluded and the one step that clears it (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * board-no-view/signed-in/paired/excluded/stale-key: names excluded and the one step that clears it (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * board-no-view/signed-in/unpaired/excluded/fresh: names excluded and the one step that clears it
 * board-no-view/signed-in/unpaired/excluded/stale-pairing: names excluded and the one step that clears it
 * board-no-view/signed-in/unpaired/excluded/stale-key: names excluded and the one step that clears it
 * board-no-view/signed-in/revoked/excluded/fresh: names excluded and the one step that clears it (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * board-no-view/signed-in/revoked/excluded/stale-pairing: names excluded and the one step that clears it (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * board-no-view/signed-in/revoked/excluded/stale-key: names excluded and the one step that clears it (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * other-computer/signed-out/paired/excluded/fresh: names sign-in and the one step that clears it (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * other-computer/signed-out/paired/excluded/stale-pairing: names sign-in and the one step that clears it (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * other-computer/signed-out/paired/excluded/stale-key: names sign-in and the one step that clears it (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * other-computer/signed-out/unpaired/excluded/fresh: names sign-in and the one step that clears it
 * other-computer/signed-out/unpaired/excluded/stale-pairing: names sign-in and the one step that clears it
 * other-computer/signed-out/unpaired/excluded/stale-key: names sign-in and the one step that clears it
 * other-computer/signed-out/revoked/excluded/fresh: names sign-in and the one step that clears it (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * other-computer/signed-out/revoked/excluded/stale-pairing: names sign-in and the one step that clears it (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * other-computer/signed-out/revoked/excluded/stale-key: names sign-in and the one step that clears it (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * other-computer/signed-in/paired/excluded/fresh: names excluded and the one step that clears it (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * other-computer/signed-in/paired/excluded/stale-pairing: names excluded and the one step that clears it (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * other-computer/signed-in/paired/excluded/stale-key: names excluded and the one step that clears it (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * other-computer/signed-in/unpaired/excluded/fresh: names excluded and the one step that clears it
 * other-computer/signed-in/unpaired/excluded/stale-pairing: names excluded and the one step that clears it
 * other-computer/signed-in/unpaired/excluded/stale-key: names excluded and the one step that clears it
 * other-computer/signed-in/revoked/excluded/fresh: names excluded and the one step that clears it (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * other-computer/signed-in/revoked/excluded/stale-pairing: names excluded and the one step that clears it (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * other-computer/signed-in/revoked/excluded/stale-key: names excluded and the one step that clears it (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * phone/signed-out/paired/excluded/fresh: names sign-in and the one step that clears it (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * phone/signed-out/paired/excluded/stale-pairing: names sign-in and the one step that clears it (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * phone/signed-out/paired/excluded/stale-key: names sign-in and the one step that clears it (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * phone/signed-out/unpaired/excluded/fresh: names sign-in and the one step that clears it
 * phone/signed-out/unpaired/excluded/stale-pairing: names sign-in and the one step that clears it
 * phone/signed-out/unpaired/excluded/stale-key: names sign-in and the one step that clears it
 * phone/signed-out/revoked/excluded/fresh: names sign-in and the one step that clears it (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * phone/signed-out/revoked/excluded/stale-pairing: names sign-in and the one step that clears it (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * phone/signed-out/revoked/excluded/stale-key: names sign-in and the one step that clears it (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * phone/signed-in/paired/excluded/fresh: names excluded and the one step that clears it (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * phone/signed-in/paired/excluded/stale-pairing: names excluded and the one step that clears it (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * phone/signed-in/paired/excluded/stale-key: names excluded and the one step that clears it (cannot exist: pairing hands a browser the key of a linked board; with no board linked there is no key to hold; runs as unpaired)
 * phone/signed-in/unpaired/excluded/fresh: names excluded and the one step that clears it
 * phone/signed-in/unpaired/excluded/stale-pairing: names excluded and the one step that clears it
 * phone/signed-in/unpaired/excluded/stale-key: names excluded and the one step that clears it
 * phone/signed-in/revoked/excluded/fresh: names excluded and the one step that clears it (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * phone/signed-in/revoked/excluded/stale-pairing: names excluded and the one step that clears it (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * phone/signed-in/revoked/excluded/stale-key: names excluded and the one step that clears it (cannot exist: only an enrolled browser can be revoked, and relay on --all enrolls one only while it links a board; runs as unpaired)
 * board-view/signed-out/paired/healthy/fresh: the board within 3 s
 * board-view/signed-out/paired/healthy/stale-pairing: the board within 3 s
 * board-view/signed-out/paired/healthy/stale-key: the board within 3 s
 * board-view/signed-out/unpaired/healthy/fresh: the board within 3 s
 * board-view/signed-out/unpaired/healthy/stale-pairing: the board within 3 s
 * board-view/signed-out/unpaired/healthy/stale-key: the board within 3 s
 * board-view/signed-out/revoked/healthy/fresh: the board within 3 s
 * board-view/signed-out/revoked/healthy/stale-pairing: the board within 3 s
 * board-view/signed-out/revoked/healthy/stale-key: the board within 3 s
 * board-view/signed-in/paired/healthy/fresh: the board within 3 s
 * board-view/signed-in/paired/healthy/stale-pairing: the board within 3 s
 * board-view/signed-in/paired/healthy/stale-key: the board within 3 s
 * board-view/signed-in/unpaired/healthy/fresh: the board within 3 s
 * board-view/signed-in/unpaired/healthy/stale-pairing: the board within 3 s
 * board-view/signed-in/unpaired/healthy/stale-key: the board within 3 s
 * board-view/signed-in/revoked/healthy/fresh: the board within 3 s
 * board-view/signed-in/revoked/healthy/stale-pairing: the board within 3 s
 * board-view/signed-in/revoked/healthy/stale-key: the board within 3 s
 * board-no-view/signed-out/paired/healthy/fresh: names sign-in and the one step that clears it
 * board-no-view/signed-out/paired/healthy/stale-pairing: names sign-in and the one step that clears it
 * board-no-view/signed-out/paired/healthy/stale-key: names sign-in and the one step that clears it
 * board-no-view/signed-out/unpaired/healthy/fresh: names sign-in and the one step that clears it
 * board-no-view/signed-out/unpaired/healthy/stale-pairing: names sign-in and the one step that clears it
 * board-no-view/signed-out/unpaired/healthy/stale-key: names sign-in and the one step that clears it
 * board-no-view/signed-out/revoked/healthy/fresh: names sign-in and the one step that clears it
 * board-no-view/signed-out/revoked/healthy/stale-pairing: names sign-in and the one step that clears it
 * board-no-view/signed-out/revoked/healthy/stale-key: names sign-in and the one step that clears it
 * board-no-view/signed-in/paired/healthy/fresh: the board within 3 s
 * board-no-view/signed-in/paired/healthy/stale-pairing: the board within 3 s
 * board-no-view/signed-in/paired/healthy/stale-key: names stale-key and the one step that clears it
 * board-no-view/signed-in/unpaired/healthy/fresh: names unpaired and the one step that clears it
 * board-no-view/signed-in/unpaired/healthy/stale-pairing: names unpaired and the one step that clears it
 * board-no-view/signed-in/unpaired/healthy/stale-key: names unpaired and the one step that clears it
 * board-no-view/signed-in/revoked/healthy/fresh: names removed and the one step that clears it
 * board-no-view/signed-in/revoked/healthy/stale-pairing: names removed and the one step that clears it
 * board-no-view/signed-in/revoked/healthy/stale-key: names removed and the one step that clears it
 * other-computer/signed-out/paired/healthy/fresh: names sign-in and the one step that clears it
 * other-computer/signed-out/paired/healthy/stale-pairing: names sign-in and the one step that clears it
 * other-computer/signed-out/paired/healthy/stale-key: names sign-in and the one step that clears it
 * other-computer/signed-out/unpaired/healthy/fresh: names sign-in and the one step that clears it
 * other-computer/signed-out/unpaired/healthy/stale-pairing: names sign-in and the one step that clears it
 * other-computer/signed-out/unpaired/healthy/stale-key: names sign-in and the one step that clears it
 * other-computer/signed-out/revoked/healthy/fresh: names sign-in and the one step that clears it
 * other-computer/signed-out/revoked/healthy/stale-pairing: names sign-in and the one step that clears it
 * other-computer/signed-out/revoked/healthy/stale-key: names sign-in and the one step that clears it
 * other-computer/signed-in/paired/healthy/fresh: the board within 3 s
 * other-computer/signed-in/paired/healthy/stale-pairing: the board within 3 s
 * other-computer/signed-in/paired/healthy/stale-key: names stale-key and the one step that clears it
 * other-computer/signed-in/unpaired/healthy/fresh: names unpaired and the one step that clears it
 * other-computer/signed-in/unpaired/healthy/stale-pairing: names unpaired and the one step that clears it
 * other-computer/signed-in/unpaired/healthy/stale-key: names unpaired and the one step that clears it
 * other-computer/signed-in/revoked/healthy/fresh: names removed and the one step that clears it
 * other-computer/signed-in/revoked/healthy/stale-pairing: names removed and the one step that clears it
 * other-computer/signed-in/revoked/healthy/stale-key: names removed and the one step that clears it
 * phone/signed-out/paired/healthy/fresh: names sign-in and the one step that clears it
 * phone/signed-out/paired/healthy/stale-pairing: names sign-in and the one step that clears it
 * phone/signed-out/paired/healthy/stale-key: names sign-in and the one step that clears it
 * phone/signed-out/unpaired/healthy/fresh: names sign-in and the one step that clears it
 * phone/signed-out/unpaired/healthy/stale-pairing: names sign-in and the one step that clears it
 * phone/signed-out/unpaired/healthy/stale-key: names sign-in and the one step that clears it
 * phone/signed-out/revoked/healthy/fresh: names sign-in and the one step that clears it
 * phone/signed-out/revoked/healthy/stale-pairing: names sign-in and the one step that clears it
 * phone/signed-out/revoked/healthy/stale-key: names sign-in and the one step that clears it
 * phone/signed-in/paired/healthy/fresh: the board within 3 s
 * phone/signed-in/paired/healthy/stale-pairing: the board within 3 s
 * phone/signed-in/paired/healthy/stale-key: names stale-key and the one step that clears it
 * phone/signed-in/unpaired/healthy/fresh: names unpaired and the one step that clears it
 * phone/signed-in/unpaired/healthy/stale-pairing: names unpaired and the one step that clears it
 * phone/signed-in/unpaired/healthy/stale-key: names unpaired and the one step that clears it
 * phone/signed-in/revoked/healthy/fresh: names removed and the one step that clears it
 * phone/signed-in/revoked/healthy/stale-pairing: names removed and the one step that clears it
 * phone/signed-in/revoked/healthy/stale-key: names removed and the one step that clears it
 * board-view/signed-out/paired/oversize/fresh: the board within 3 s
 * board-view/signed-out/paired/oversize/stale-pairing: the board within 3 s
 * board-view/signed-out/paired/oversize/stale-key: the board within 3 s
 * board-view/signed-out/unpaired/oversize/fresh: the board within 3 s
 * board-view/signed-out/unpaired/oversize/stale-pairing: the board within 3 s
 * board-view/signed-out/unpaired/oversize/stale-key: the board within 3 s
 * board-view/signed-out/revoked/oversize/fresh: the board within 3 s
 * board-view/signed-out/revoked/oversize/stale-pairing: the board within 3 s
 * board-view/signed-out/revoked/oversize/stale-key: the board within 3 s
 * board-view/signed-in/paired/oversize/fresh: the board within 3 s
 * board-view/signed-in/paired/oversize/stale-pairing: the board within 3 s
 * board-view/signed-in/paired/oversize/stale-key: the board within 3 s
 * board-view/signed-in/unpaired/oversize/fresh: the board within 3 s
 * board-view/signed-in/unpaired/oversize/stale-pairing: the board within 3 s
 * board-view/signed-in/unpaired/oversize/stale-key: the board within 3 s
 * board-view/signed-in/revoked/oversize/fresh: the board within 3 s
 * board-view/signed-in/revoked/oversize/stale-pairing: the board within 3 s
 * board-view/signed-in/revoked/oversize/stale-key: the board within 3 s
 * board-no-view/signed-out/paired/oversize/fresh: names sign-in and the one step that clears it
 * board-no-view/signed-out/paired/oversize/stale-pairing: names sign-in and the one step that clears it
 * board-no-view/signed-out/paired/oversize/stale-key: names sign-in and the one step that clears it
 * board-no-view/signed-out/unpaired/oversize/fresh: names sign-in and the one step that clears it
 * board-no-view/signed-out/unpaired/oversize/stale-pairing: names sign-in and the one step that clears it
 * board-no-view/signed-out/unpaired/oversize/stale-key: names sign-in and the one step that clears it
 * board-no-view/signed-out/revoked/oversize/fresh: names sign-in and the one step that clears it
 * board-no-view/signed-out/revoked/oversize/stale-pairing: names sign-in and the one step that clears it
 * board-no-view/signed-out/revoked/oversize/stale-key: names sign-in and the one step that clears it
 * board-no-view/signed-in/paired/oversize/fresh: names too-big and the one step that clears it
 * board-no-view/signed-in/paired/oversize/stale-pairing: names too-big and the one step that clears it
 * board-no-view/signed-in/paired/oversize/stale-key: names stale-key and the one step that clears it
 * board-no-view/signed-in/unpaired/oversize/fresh: names unpaired and the one step that clears it
 * board-no-view/signed-in/unpaired/oversize/stale-pairing: names unpaired and the one step that clears it
 * board-no-view/signed-in/unpaired/oversize/stale-key: names unpaired and the one step that clears it
 * board-no-view/signed-in/revoked/oversize/fresh: names removed and the one step that clears it
 * board-no-view/signed-in/revoked/oversize/stale-pairing: names removed and the one step that clears it
 * board-no-view/signed-in/revoked/oversize/stale-key: names removed and the one step that clears it
 * other-computer/signed-out/paired/oversize/fresh: names sign-in and the one step that clears it
 * other-computer/signed-out/paired/oversize/stale-pairing: names sign-in and the one step that clears it
 * other-computer/signed-out/paired/oversize/stale-key: names sign-in and the one step that clears it
 * other-computer/signed-out/unpaired/oversize/fresh: names sign-in and the one step that clears it
 * other-computer/signed-out/unpaired/oversize/stale-pairing: names sign-in and the one step that clears it
 * other-computer/signed-out/unpaired/oversize/stale-key: names sign-in and the one step that clears it
 * other-computer/signed-out/revoked/oversize/fresh: names sign-in and the one step that clears it
 * other-computer/signed-out/revoked/oversize/stale-pairing: names sign-in and the one step that clears it
 * other-computer/signed-out/revoked/oversize/stale-key: names sign-in and the one step that clears it
 * other-computer/signed-in/paired/oversize/fresh: names too-big and the one step that clears it
 * other-computer/signed-in/paired/oversize/stale-pairing: names too-big and the one step that clears it
 * other-computer/signed-in/paired/oversize/stale-key: names stale-key and the one step that clears it
 * other-computer/signed-in/unpaired/oversize/fresh: names unpaired and the one step that clears it
 * other-computer/signed-in/unpaired/oversize/stale-pairing: names unpaired and the one step that clears it
 * other-computer/signed-in/unpaired/oversize/stale-key: names unpaired and the one step that clears it
 * other-computer/signed-in/revoked/oversize/fresh: names removed and the one step that clears it
 * other-computer/signed-in/revoked/oversize/stale-pairing: names removed and the one step that clears it
 * other-computer/signed-in/revoked/oversize/stale-key: names removed and the one step that clears it
 * phone/signed-out/paired/oversize/fresh: names sign-in and the one step that clears it
 * phone/signed-out/paired/oversize/stale-pairing: names sign-in and the one step that clears it
 * phone/signed-out/paired/oversize/stale-key: names sign-in and the one step that clears it
 * phone/signed-out/unpaired/oversize/fresh: names sign-in and the one step that clears it
 * phone/signed-out/unpaired/oversize/stale-pairing: names sign-in and the one step that clears it
 * phone/signed-out/unpaired/oversize/stale-key: names sign-in and the one step that clears it
 * phone/signed-out/revoked/oversize/fresh: names sign-in and the one step that clears it
 * phone/signed-out/revoked/oversize/stale-pairing: names sign-in and the one step that clears it
 * phone/signed-out/revoked/oversize/stale-key: names sign-in and the one step that clears it
 * phone/signed-in/paired/oversize/fresh: names too-big and the one step that clears it
 * phone/signed-in/paired/oversize/stale-pairing: names too-big and the one step that clears it
 * phone/signed-in/paired/oversize/stale-key: names stale-key and the one step that clears it
 * phone/signed-in/unpaired/oversize/fresh: names unpaired and the one step that clears it
 * phone/signed-in/unpaired/oversize/stale-pairing: names unpaired and the one step that clears it
 * phone/signed-in/unpaired/oversize/stale-key: names unpaired and the one step that clears it
 * phone/signed-in/revoked/oversize/fresh: names removed and the one step that clears it
 * phone/signed-in/revoked/oversize/stale-pairing: names removed and the one step that clears it
 * phone/signed-in/revoked/oversize/stale-key: names removed and the one step that clears it
 * board-view/signed-out/paired/approval/fresh: the board within 3 s
 * board-view/signed-out/paired/approval/stale-pairing: the board within 3 s
 * board-view/signed-out/paired/approval/stale-key: the board within 3 s
 * board-view/signed-out/unpaired/approval/fresh: the board within 3 s
 * board-view/signed-out/unpaired/approval/stale-pairing: the board within 3 s
 * board-view/signed-out/unpaired/approval/stale-key: the board within 3 s
 * board-view/signed-out/revoked/approval/fresh: the board within 3 s
 * board-view/signed-out/revoked/approval/stale-pairing: the board within 3 s
 * board-view/signed-out/revoked/approval/stale-key: the board within 3 s
 * board-view/signed-in/paired/approval/fresh: the board within 3 s
 * board-view/signed-in/paired/approval/stale-pairing: the board within 3 s
 * board-view/signed-in/paired/approval/stale-key: the board within 3 s
 * board-view/signed-in/unpaired/approval/fresh: the board within 3 s
 * board-view/signed-in/unpaired/approval/stale-pairing: the board within 3 s
 * board-view/signed-in/unpaired/approval/stale-key: the board within 3 s
 * board-view/signed-in/revoked/approval/fresh: the board within 3 s
 * board-view/signed-in/revoked/approval/stale-pairing: the board within 3 s
 * board-view/signed-in/revoked/approval/stale-key: the board within 3 s
 * board-no-view/signed-out/paired/approval/fresh: names sign-in and the one step that clears it
 * board-no-view/signed-out/paired/approval/stale-pairing: names sign-in and the one step that clears it
 * board-no-view/signed-out/paired/approval/stale-key: names sign-in and the one step that clears it
 * board-no-view/signed-out/unpaired/approval/fresh: names sign-in and the one step that clears it
 * board-no-view/signed-out/unpaired/approval/stale-pairing: names sign-in and the one step that clears it
 * board-no-view/signed-out/unpaired/approval/stale-key: names sign-in and the one step that clears it
 * board-no-view/signed-out/revoked/approval/fresh: names sign-in and the one step that clears it
 * board-no-view/signed-out/revoked/approval/stale-pairing: names sign-in and the one step that clears it
 * board-no-view/signed-out/revoked/approval/stale-key: names sign-in and the one step that clears it
 * board-no-view/signed-in/paired/approval/fresh: the board within 3 s, and names approval
 * board-no-view/signed-in/paired/approval/stale-pairing: the board within 3 s, and names approval
 * board-no-view/signed-in/paired/approval/stale-key: names stale-key and the one step that clears it
 * board-no-view/signed-in/unpaired/approval/fresh: names unpaired and the one step that clears it
 * board-no-view/signed-in/unpaired/approval/stale-pairing: names unpaired and the one step that clears it
 * board-no-view/signed-in/unpaired/approval/stale-key: names unpaired and the one step that clears it
 * board-no-view/signed-in/revoked/approval/fresh: names removed and the one step that clears it
 * board-no-view/signed-in/revoked/approval/stale-pairing: names removed and the one step that clears it
 * board-no-view/signed-in/revoked/approval/stale-key: names removed and the one step that clears it
 * other-computer/signed-out/paired/approval/fresh: names sign-in and the one step that clears it
 * other-computer/signed-out/paired/approval/stale-pairing: names sign-in and the one step that clears it
 * other-computer/signed-out/paired/approval/stale-key: names sign-in and the one step that clears it
 * other-computer/signed-out/unpaired/approval/fresh: names sign-in and the one step that clears it
 * other-computer/signed-out/unpaired/approval/stale-pairing: names sign-in and the one step that clears it
 * other-computer/signed-out/unpaired/approval/stale-key: names sign-in and the one step that clears it
 * other-computer/signed-out/revoked/approval/fresh: names sign-in and the one step that clears it
 * other-computer/signed-out/revoked/approval/stale-pairing: names sign-in and the one step that clears it
 * other-computer/signed-out/revoked/approval/stale-key: names sign-in and the one step that clears it
 * other-computer/signed-in/paired/approval/fresh: the board within 3 s, and names approval
 * other-computer/signed-in/paired/approval/stale-pairing: the board within 3 s, and names approval
 * other-computer/signed-in/paired/approval/stale-key: names stale-key and the one step that clears it
 * other-computer/signed-in/unpaired/approval/fresh: names unpaired and the one step that clears it
 * other-computer/signed-in/unpaired/approval/stale-pairing: names unpaired and the one step that clears it
 * other-computer/signed-in/unpaired/approval/stale-key: names unpaired and the one step that clears it
 * other-computer/signed-in/revoked/approval/fresh: names removed and the one step that clears it
 * other-computer/signed-in/revoked/approval/stale-pairing: names removed and the one step that clears it
 * other-computer/signed-in/revoked/approval/stale-key: names removed and the one step that clears it
 * phone/signed-out/paired/approval/fresh: names sign-in and the one step that clears it
 * phone/signed-out/paired/approval/stale-pairing: names sign-in and the one step that clears it
 * phone/signed-out/paired/approval/stale-key: names sign-in and the one step that clears it
 * phone/signed-out/unpaired/approval/fresh: names sign-in and the one step that clears it
 * phone/signed-out/unpaired/approval/stale-pairing: names sign-in and the one step that clears it
 * phone/signed-out/unpaired/approval/stale-key: names sign-in and the one step that clears it
 * phone/signed-out/revoked/approval/fresh: names sign-in and the one step that clears it
 * phone/signed-out/revoked/approval/stale-pairing: names sign-in and the one step that clears it
 * phone/signed-out/revoked/approval/stale-key: names sign-in and the one step that clears it
 * phone/signed-in/paired/approval/fresh: the board within 3 s, and names approval
 * phone/signed-in/paired/approval/stale-pairing: the board within 3 s, and names approval
 * phone/signed-in/paired/approval/stale-key: names stale-key and the one step that clears it
 * phone/signed-in/unpaired/approval/fresh: names unpaired and the one step that clears it
 * phone/signed-in/unpaired/approval/stale-pairing: names unpaired and the one step that clears it
 * phone/signed-in/unpaired/approval/stale-key: names unpaired and the one step that clears it
 * phone/signed-in/revoked/approval/fresh: names removed and the one step that clears it
 * phone/signed-in/revoked/approval/stale-pairing: names removed and the one step that clears it
 * phone/signed-in/revoked/approval/stale-key: names removed and the one step that clears it
 * board-view/signed-out/paired/mixed/fresh: the board within 3 s
 * board-view/signed-out/paired/mixed/stale-pairing: the board within 3 s
 * board-view/signed-out/paired/mixed/stale-key: the board within 3 s
 * board-view/signed-out/unpaired/mixed/fresh: the board within 3 s
 * board-view/signed-out/unpaired/mixed/stale-pairing: the board within 3 s
 * board-view/signed-out/unpaired/mixed/stale-key: the board within 3 s
 * board-view/signed-out/revoked/mixed/fresh: the board within 3 s
 * board-view/signed-out/revoked/mixed/stale-pairing: the board within 3 s
 * board-view/signed-out/revoked/mixed/stale-key: the board within 3 s
 * board-view/signed-in/paired/mixed/fresh: the board within 3 s
 * board-view/signed-in/paired/mixed/stale-pairing: the board within 3 s
 * board-view/signed-in/paired/mixed/stale-key: the board within 3 s
 * board-view/signed-in/unpaired/mixed/fresh: the board within 3 s
 * board-view/signed-in/unpaired/mixed/stale-pairing: the board within 3 s
 * board-view/signed-in/unpaired/mixed/stale-key: the board within 3 s
 * board-view/signed-in/revoked/mixed/fresh: the board within 3 s
 * board-view/signed-in/revoked/mixed/stale-pairing: the board within 3 s
 * board-view/signed-in/revoked/mixed/stale-key: the board within 3 s
 * board-no-view/signed-out/paired/mixed/fresh: names sign-in and the one step that clears it
 * board-no-view/signed-out/paired/mixed/stale-pairing: names sign-in and the one step that clears it
 * board-no-view/signed-out/paired/mixed/stale-key: names sign-in and the one step that clears it
 * board-no-view/signed-out/unpaired/mixed/fresh: names sign-in and the one step that clears it
 * board-no-view/signed-out/unpaired/mixed/stale-pairing: names sign-in and the one step that clears it
 * board-no-view/signed-out/unpaired/mixed/stale-key: names sign-in and the one step that clears it
 * board-no-view/signed-out/revoked/mixed/fresh: names sign-in and the one step that clears it
 * board-no-view/signed-out/revoked/mixed/stale-pairing: names sign-in and the one step that clears it
 * board-no-view/signed-out/revoked/mixed/stale-key: names sign-in and the one step that clears it
 * board-no-view/signed-in/paired/mixed/fresh: the board within 3 s, and names too-big
 * board-no-view/signed-in/paired/mixed/stale-pairing: the board within 3 s, and names too-big
 * board-no-view/signed-in/paired/mixed/stale-key: names stale-key and the one step that clears it
 * board-no-view/signed-in/unpaired/mixed/fresh: names unpaired and the one step that clears it
 * board-no-view/signed-in/unpaired/mixed/stale-pairing: names unpaired and the one step that clears it
 * board-no-view/signed-in/unpaired/mixed/stale-key: names unpaired and the one step that clears it
 * board-no-view/signed-in/revoked/mixed/fresh: names removed and the one step that clears it
 * board-no-view/signed-in/revoked/mixed/stale-pairing: names removed and the one step that clears it
 * board-no-view/signed-in/revoked/mixed/stale-key: names removed and the one step that clears it
 * other-computer/signed-out/paired/mixed/fresh: names sign-in and the one step that clears it
 * other-computer/signed-out/paired/mixed/stale-pairing: names sign-in and the one step that clears it
 * other-computer/signed-out/paired/mixed/stale-key: names sign-in and the one step that clears it
 * other-computer/signed-out/unpaired/mixed/fresh: names sign-in and the one step that clears it
 * other-computer/signed-out/unpaired/mixed/stale-pairing: names sign-in and the one step that clears it
 * other-computer/signed-out/unpaired/mixed/stale-key: names sign-in and the one step that clears it
 * other-computer/signed-out/revoked/mixed/fresh: names sign-in and the one step that clears it
 * other-computer/signed-out/revoked/mixed/stale-pairing: names sign-in and the one step that clears it
 * other-computer/signed-out/revoked/mixed/stale-key: names sign-in and the one step that clears it
 * other-computer/signed-in/paired/mixed/fresh: the board within 3 s, and names too-big
 * other-computer/signed-in/paired/mixed/stale-pairing: the board within 3 s, and names too-big
 * other-computer/signed-in/paired/mixed/stale-key: names stale-key and the one step that clears it
 * other-computer/signed-in/unpaired/mixed/fresh: names unpaired and the one step that clears it
 * other-computer/signed-in/unpaired/mixed/stale-pairing: names unpaired and the one step that clears it
 * other-computer/signed-in/unpaired/mixed/stale-key: names unpaired and the one step that clears it
 * other-computer/signed-in/revoked/mixed/fresh: names removed and the one step that clears it
 * other-computer/signed-in/revoked/mixed/stale-pairing: names removed and the one step that clears it
 * other-computer/signed-in/revoked/mixed/stale-key: names removed and the one step that clears it
 * phone/signed-out/paired/mixed/fresh: names sign-in and the one step that clears it
 * phone/signed-out/paired/mixed/stale-pairing: names sign-in and the one step that clears it
 * phone/signed-out/paired/mixed/stale-key: names sign-in and the one step that clears it
 * phone/signed-out/unpaired/mixed/fresh: names sign-in and the one step that clears it
 * phone/signed-out/unpaired/mixed/stale-pairing: names sign-in and the one step that clears it
 * phone/signed-out/unpaired/mixed/stale-key: names sign-in and the one step that clears it
 * phone/signed-out/revoked/mixed/fresh: names sign-in and the one step that clears it
 * phone/signed-out/revoked/mixed/stale-pairing: names sign-in and the one step that clears it
 * phone/signed-out/revoked/mixed/stale-key: names sign-in and the one step that clears it
 * phone/signed-in/paired/mixed/fresh: the board within 3 s, and names too-big
 * phone/signed-in/paired/mixed/stale-pairing: the board within 3 s, and names too-big
 * phone/signed-in/paired/mixed/stale-key: names stale-key and the one step that clears it
 * phone/signed-in/unpaired/mixed/fresh: names unpaired and the one step that clears it
 * phone/signed-in/unpaired/mixed/stale-pairing: names unpaired and the one step that clears it
 * phone/signed-in/unpaired/mixed/stale-key: names unpaired and the one step that clears it
 * phone/signed-in/revoked/mixed/fresh: names removed and the one step that clears it
 * phone/signed-in/revoked/mixed/stale-pairing: names removed and the one step that clears it
 * phone/signed-in/revoked/mixed/stale-key: names removed and the one step that clears it
 * CELLS-END
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { relayClientFixture } from './relay-client-fixture.js';
import { enrollProtocolPhone } from './relay-device-enrollment-fixture.js';
import { hostedEngines } from './hosted-browsers.js';
import { openEngine } from './hosted-browsers.js';
import {
  BOARDS,
  READ_SCREEN,
  STORED,
  boardView,
  cells,
  enrolledDevices,
  expected,
  freshSession,
  headerLine,
  hostedFront,
  impossibility,
  judge,
  relayOnAll,
  relayPairClears,
  revokeDevice,
  siblingProject,
  storedScript,
  visit,
} from './hosted-shapes-fixture.js';

/**
 * Each failing cell's cause: one filed defect per cause, listing every cell it covers as engine:cell. A fix removes
 * its cause, and the matrix then requires those cells to pass; a listed cell that passes fails the run, so the lists
 * stay true.
 */
const CAUSES = [
  {
    item: 976,
    cause: "WebKit cannot decode the gzip snapshot piped from a Blob stream, so a paired browser never opens a linked board",
    cells: [
      'webkit:board-no-view/signed-in/paired/approval/fresh',
      'webkit:board-no-view/signed-in/paired/healthy/fresh',
      'webkit:board-no-view/signed-in/paired/mixed/fresh',
      'webkit:other-computer/signed-in/paired/approval/fresh',
      'webkit:other-computer/signed-in/paired/healthy/fresh',
      'webkit:other-computer/signed-in/paired/mixed/fresh',
      'webkit:phone/signed-in/paired/approval/fresh',
      'webkit:phone/signed-in/paired/healthy/fresh',
      'webkit:phone/signed-in/paired/mixed/fresh',
    ],
  },
  {
    item: 978,
    cause: "the page tells an unpaired browser to run pullboard relay pair, which does not pair it",
    cells: [
      'chromium:board-no-view/signed-in/paired/approval/stale-key',
      'chromium:board-no-view/signed-in/paired/healthy/stale-key',
      'chromium:board-no-view/signed-in/paired/mixed/stale-key',
      'chromium:board-no-view/signed-in/unpaired/approval/fresh',
      'chromium:board-no-view/signed-in/unpaired/approval/stale-key',
      'chromium:board-no-view/signed-in/unpaired/healthy/fresh',
      'chromium:board-no-view/signed-in/unpaired/healthy/stale-key',
      'chromium:board-no-view/signed-in/unpaired/mixed/fresh',
      'chromium:board-no-view/signed-in/unpaired/mixed/stale-key',
      'chromium:board-no-view/signed-in/unpaired/oversize/fresh',
      'chromium:other-computer/signed-in/paired/approval/stale-key',
      'chromium:other-computer/signed-in/paired/healthy/stale-key',
      'chromium:other-computer/signed-in/paired/mixed/stale-key',
      'chromium:other-computer/signed-in/unpaired/approval/fresh',
      'chromium:other-computer/signed-in/unpaired/approval/stale-key',
      'chromium:other-computer/signed-in/unpaired/healthy/fresh',
      'chromium:other-computer/signed-in/unpaired/healthy/stale-key',
      'chromium:other-computer/signed-in/unpaired/mixed/fresh',
      'chromium:other-computer/signed-in/unpaired/mixed/stale-key',
      'chromium:other-computer/signed-in/unpaired/oversize/fresh',
      'chromium:phone/signed-in/paired/approval/stale-key',
      'chromium:phone/signed-in/paired/healthy/stale-key',
      'chromium:phone/signed-in/paired/mixed/stale-key',
      'chromium:phone/signed-in/unpaired/approval/fresh',
      'chromium:phone/signed-in/unpaired/approval/stale-key',
      'chromium:phone/signed-in/unpaired/healthy/fresh',
      'chromium:phone/signed-in/unpaired/healthy/stale-key',
      'chromium:phone/signed-in/unpaired/mixed/fresh',
      'chromium:phone/signed-in/unpaired/mixed/stale-key',
      'chromium:phone/signed-in/unpaired/oversize/fresh',
      'webkit:board-no-view/signed-in/paired/approval/stale-key',
      'webkit:board-no-view/signed-in/paired/healthy/stale-key',
      'webkit:board-no-view/signed-in/paired/mixed/stale-key',
      'webkit:board-no-view/signed-in/unpaired/approval/fresh',
      'webkit:board-no-view/signed-in/unpaired/approval/stale-key',
      'webkit:board-no-view/signed-in/unpaired/healthy/fresh',
      'webkit:board-no-view/signed-in/unpaired/healthy/stale-key',
      'webkit:board-no-view/signed-in/unpaired/mixed/fresh',
      'webkit:board-no-view/signed-in/unpaired/mixed/stale-key',
      'webkit:board-no-view/signed-in/unpaired/oversize/fresh',
      'webkit:other-computer/signed-in/paired/approval/stale-key',
      'webkit:other-computer/signed-in/paired/healthy/stale-key',
      'webkit:other-computer/signed-in/paired/mixed/stale-key',
      'webkit:other-computer/signed-in/unpaired/approval/fresh',
      'webkit:other-computer/signed-in/unpaired/approval/stale-key',
      'webkit:other-computer/signed-in/unpaired/healthy/fresh',
      'webkit:other-computer/signed-in/unpaired/healthy/stale-key',
      'webkit:other-computer/signed-in/unpaired/mixed/fresh',
      'webkit:other-computer/signed-in/unpaired/mixed/stale-key',
      'webkit:other-computer/signed-in/unpaired/oversize/fresh',
      'webkit:phone/signed-in/paired/approval/stale-key',
      'webkit:phone/signed-in/paired/healthy/stale-key',
      'webkit:phone/signed-in/paired/mixed/stale-key',
      'webkit:phone/signed-in/unpaired/approval/fresh',
      'webkit:phone/signed-in/unpaired/approval/stale-key',
      'webkit:phone/signed-in/unpaired/healthy/fresh',
      'webkit:phone/signed-in/unpaired/healthy/stale-key',
      'webkit:phone/signed-in/unpaired/mixed/fresh',
      'webkit:phone/signed-in/unpaired/mixed/stale-key',
      'webkit:phone/signed-in/unpaired/oversize/fresh',
    ],
  },
  {
    item: 981,
    cause: "a revoked browser gets a blank page on a computer (the removed notice sits under the share screen) and a sign-in screen on a phone",
    cells: [
      'chromium:board-no-view/signed-in/revoked/approval/fresh',
      'chromium:board-no-view/signed-in/revoked/approval/stale-key',
      'chromium:board-no-view/signed-in/revoked/approval/stale-pairing',
      'chromium:board-no-view/signed-in/revoked/healthy/fresh',
      'chromium:board-no-view/signed-in/revoked/healthy/stale-key',
      'chromium:board-no-view/signed-in/revoked/healthy/stale-pairing',
      'chromium:board-no-view/signed-in/revoked/mixed/fresh',
      'chromium:board-no-view/signed-in/revoked/mixed/stale-key',
      'chromium:board-no-view/signed-in/revoked/mixed/stale-pairing',
      'chromium:board-no-view/signed-in/revoked/oversize/fresh',
      'chromium:board-no-view/signed-in/revoked/oversize/stale-key',
      'chromium:board-no-view/signed-in/revoked/oversize/stale-pairing',
      'chromium:other-computer/signed-in/revoked/approval/fresh',
      'chromium:other-computer/signed-in/revoked/approval/stale-key',
      'chromium:other-computer/signed-in/revoked/approval/stale-pairing',
      'chromium:other-computer/signed-in/revoked/healthy/fresh',
      'chromium:other-computer/signed-in/revoked/healthy/stale-key',
      'chromium:other-computer/signed-in/revoked/healthy/stale-pairing',
      'chromium:other-computer/signed-in/revoked/mixed/fresh',
      'chromium:other-computer/signed-in/revoked/mixed/stale-key',
      'chromium:other-computer/signed-in/revoked/mixed/stale-pairing',
      'chromium:other-computer/signed-in/revoked/oversize/fresh',
      'chromium:other-computer/signed-in/revoked/oversize/stale-key',
      'chromium:other-computer/signed-in/revoked/oversize/stale-pairing',
      'chromium:phone/signed-in/revoked/approval/fresh',
      'chromium:phone/signed-in/revoked/approval/stale-key',
      'chromium:phone/signed-in/revoked/approval/stale-pairing',
      'chromium:phone/signed-in/revoked/healthy/fresh',
      'chromium:phone/signed-in/revoked/healthy/stale-key',
      'chromium:phone/signed-in/revoked/healthy/stale-pairing',
      'chromium:phone/signed-in/revoked/mixed/fresh',
      'chromium:phone/signed-in/revoked/mixed/stale-key',
      'chromium:phone/signed-in/revoked/mixed/stale-pairing',
      'chromium:phone/signed-in/revoked/oversize/fresh',
      'chromium:phone/signed-in/revoked/oversize/stale-key',
      'chromium:phone/signed-in/revoked/oversize/stale-pairing',
      'webkit:board-no-view/signed-in/revoked/approval/fresh',
      'webkit:board-no-view/signed-in/revoked/approval/stale-key',
      'webkit:board-no-view/signed-in/revoked/approval/stale-pairing',
      'webkit:board-no-view/signed-in/revoked/healthy/fresh',
      'webkit:board-no-view/signed-in/revoked/healthy/stale-key',
      'webkit:board-no-view/signed-in/revoked/healthy/stale-pairing',
      'webkit:board-no-view/signed-in/revoked/mixed/fresh',
      'webkit:board-no-view/signed-in/revoked/mixed/stale-key',
      'webkit:board-no-view/signed-in/revoked/mixed/stale-pairing',
      'webkit:board-no-view/signed-in/revoked/oversize/fresh',
      'webkit:board-no-view/signed-in/revoked/oversize/stale-key',
      'webkit:board-no-view/signed-in/revoked/oversize/stale-pairing',
      'webkit:other-computer/signed-in/revoked/approval/fresh',
      'webkit:other-computer/signed-in/revoked/approval/stale-key',
      'webkit:other-computer/signed-in/revoked/approval/stale-pairing',
      'webkit:other-computer/signed-in/revoked/healthy/fresh',
      'webkit:other-computer/signed-in/revoked/healthy/stale-key',
      'webkit:other-computer/signed-in/revoked/healthy/stale-pairing',
      'webkit:other-computer/signed-in/revoked/mixed/fresh',
      'webkit:other-computer/signed-in/revoked/mixed/stale-key',
      'webkit:other-computer/signed-in/revoked/mixed/stale-pairing',
      'webkit:other-computer/signed-in/revoked/oversize/fresh',
      'webkit:other-computer/signed-in/revoked/oversize/stale-key',
      'webkit:other-computer/signed-in/revoked/oversize/stale-pairing',
      'webkit:phone/signed-in/revoked/approval/fresh',
      'webkit:phone/signed-in/revoked/approval/stale-key',
      'webkit:phone/signed-in/revoked/approval/stale-pairing',
      'webkit:phone/signed-in/revoked/healthy/fresh',
      'webkit:phone/signed-in/revoked/healthy/stale-key',
      'webkit:phone/signed-in/revoked/healthy/stale-pairing',
      'webkit:phone/signed-in/revoked/mixed/fresh',
      'webkit:phone/signed-in/revoked/mixed/stale-key',
      'webkit:phone/signed-in/revoked/mixed/stale-pairing',
      'webkit:phone/signed-in/revoked/oversize/fresh',
      'webkit:phone/signed-in/revoked/oversize/stale-key',
      'webkit:phone/signed-in/revoked/oversize/stale-pairing',
    ],
  },
  {
    item: 982,
    cause: "an expired pairing link left in the browser blocks the page with DEVICE_PAIR_EXPIRED and relay on --all, a step already taken",
    cells: [
      'chromium:board-no-view/signed-in/paired/approval/stale-pairing',
      'chromium:board-no-view/signed-in/paired/excluded/stale-pairing',
      'chromium:board-no-view/signed-in/paired/healthy/stale-pairing',
      'chromium:board-no-view/signed-in/paired/mixed/stale-pairing',
      'chromium:board-no-view/signed-in/paired/none/stale-pairing',
      'chromium:board-no-view/signed-in/paired/oversize/stale-pairing',
      'chromium:board-no-view/signed-in/revoked/excluded/stale-pairing',
      'chromium:board-no-view/signed-in/revoked/none/stale-pairing',
      'chromium:board-no-view/signed-in/unpaired/approval/stale-pairing',
      'chromium:board-no-view/signed-in/unpaired/excluded/stale-pairing',
      'chromium:board-no-view/signed-in/unpaired/healthy/stale-pairing',
      'chromium:board-no-view/signed-in/unpaired/mixed/stale-pairing',
      'chromium:board-no-view/signed-in/unpaired/none/stale-pairing',
      'chromium:board-no-view/signed-in/unpaired/oversize/stale-pairing',
      'chromium:other-computer/signed-in/paired/approval/stale-pairing',
      'chromium:other-computer/signed-in/paired/excluded/stale-pairing',
      'chromium:other-computer/signed-in/paired/healthy/stale-pairing',
      'chromium:other-computer/signed-in/paired/mixed/stale-pairing',
      'chromium:other-computer/signed-in/paired/none/stale-pairing',
      'chromium:other-computer/signed-in/paired/oversize/stale-pairing',
      'chromium:other-computer/signed-in/revoked/excluded/stale-pairing',
      'chromium:other-computer/signed-in/revoked/none/stale-pairing',
      'chromium:other-computer/signed-in/unpaired/approval/stale-pairing',
      'chromium:other-computer/signed-in/unpaired/excluded/stale-pairing',
      'chromium:other-computer/signed-in/unpaired/healthy/stale-pairing',
      'chromium:other-computer/signed-in/unpaired/mixed/stale-pairing',
      'chromium:other-computer/signed-in/unpaired/none/stale-pairing',
      'chromium:other-computer/signed-in/unpaired/oversize/stale-pairing',
      'chromium:phone/signed-in/paired/approval/stale-pairing',
      'chromium:phone/signed-in/paired/excluded/stale-pairing',
      'chromium:phone/signed-in/paired/healthy/stale-pairing',
      'chromium:phone/signed-in/paired/mixed/stale-pairing',
      'chromium:phone/signed-in/paired/none/stale-pairing',
      'chromium:phone/signed-in/paired/oversize/stale-pairing',
      'chromium:phone/signed-in/revoked/excluded/stale-pairing',
      'chromium:phone/signed-in/revoked/none/stale-pairing',
      'chromium:phone/signed-in/unpaired/approval/stale-pairing',
      'chromium:phone/signed-in/unpaired/excluded/stale-pairing',
      'chromium:phone/signed-in/unpaired/healthy/stale-pairing',
      'chromium:phone/signed-in/unpaired/mixed/stale-pairing',
      'chromium:phone/signed-in/unpaired/none/stale-pairing',
      'chromium:phone/signed-in/unpaired/oversize/stale-pairing',
      'webkit:board-no-view/signed-in/paired/approval/stale-pairing',
      'webkit:board-no-view/signed-in/paired/excluded/stale-pairing',
      'webkit:board-no-view/signed-in/paired/healthy/stale-pairing',
      'webkit:board-no-view/signed-in/paired/mixed/stale-pairing',
      'webkit:board-no-view/signed-in/paired/none/stale-pairing',
      'webkit:board-no-view/signed-in/paired/oversize/stale-pairing',
      'webkit:board-no-view/signed-in/revoked/excluded/stale-pairing',
      'webkit:board-no-view/signed-in/revoked/none/stale-pairing',
      'webkit:board-no-view/signed-in/unpaired/approval/stale-pairing',
      'webkit:board-no-view/signed-in/unpaired/excluded/stale-pairing',
      'webkit:board-no-view/signed-in/unpaired/healthy/stale-pairing',
      'webkit:board-no-view/signed-in/unpaired/mixed/stale-pairing',
      'webkit:board-no-view/signed-in/unpaired/none/stale-pairing',
      'webkit:board-no-view/signed-in/unpaired/oversize/stale-pairing',
      'webkit:other-computer/signed-in/paired/approval/stale-pairing',
      'webkit:other-computer/signed-in/paired/excluded/stale-pairing',
      'webkit:other-computer/signed-in/paired/healthy/stale-pairing',
      'webkit:other-computer/signed-in/paired/mixed/stale-pairing',
      'webkit:other-computer/signed-in/paired/none/stale-pairing',
      'webkit:other-computer/signed-in/paired/oversize/stale-pairing',
      'webkit:other-computer/signed-in/revoked/excluded/stale-pairing',
      'webkit:other-computer/signed-in/revoked/none/stale-pairing',
      'webkit:other-computer/signed-in/unpaired/approval/stale-pairing',
      'webkit:other-computer/signed-in/unpaired/excluded/stale-pairing',
      'webkit:other-computer/signed-in/unpaired/healthy/stale-pairing',
      'webkit:other-computer/signed-in/unpaired/mixed/stale-pairing',
      'webkit:other-computer/signed-in/unpaired/none/stale-pairing',
      'webkit:other-computer/signed-in/unpaired/oversize/stale-pairing',
      'webkit:phone/signed-in/paired/approval/stale-pairing',
      'webkit:phone/signed-in/paired/excluded/stale-pairing',
      'webkit:phone/signed-in/paired/healthy/stale-pairing',
      'webkit:phone/signed-in/paired/mixed/stale-pairing',
      'webkit:phone/signed-in/paired/none/stale-pairing',
      'webkit:phone/signed-in/paired/oversize/stale-pairing',
      'webkit:phone/signed-in/revoked/excluded/stale-pairing',
      'webkit:phone/signed-in/revoked/none/stale-pairing',
      'webkit:phone/signed-in/unpaired/approval/stale-pairing',
      'webkit:phone/signed-in/unpaired/excluded/stale-pairing',
      'webkit:phone/signed-in/unpaired/healthy/stale-pairing',
      'webkit:phone/signed-in/unpaired/mixed/stale-pairing',
      'webkit:phone/signed-in/unpaired/none/stale-pairing',
      'webkit:phone/signed-in/unpaired/oversize/stale-pairing',
    ],
  },
  {
    item: 983,
    cause: "an excluded board is never named; the page offers relay on --all, which skips it and was already run",
    cells: [
      'chromium:board-no-view/signed-in/paired/excluded/fresh',
      'chromium:board-no-view/signed-in/paired/excluded/stale-key',
      'chromium:board-no-view/signed-in/revoked/excluded/fresh',
      'chromium:board-no-view/signed-in/revoked/excluded/stale-key',
      'chromium:board-no-view/signed-in/unpaired/excluded/fresh',
      'chromium:board-no-view/signed-in/unpaired/excluded/stale-key',
      'chromium:other-computer/signed-in/paired/excluded/fresh',
      'chromium:other-computer/signed-in/paired/excluded/stale-key',
      'chromium:other-computer/signed-in/revoked/excluded/fresh',
      'chromium:other-computer/signed-in/revoked/excluded/stale-key',
      'chromium:other-computer/signed-in/unpaired/excluded/fresh',
      'chromium:other-computer/signed-in/unpaired/excluded/stale-key',
      'chromium:phone/signed-in/paired/excluded/fresh',
      'chromium:phone/signed-in/paired/excluded/stale-key',
      'chromium:phone/signed-in/revoked/excluded/fresh',
      'chromium:phone/signed-in/revoked/excluded/stale-key',
      'chromium:phone/signed-in/unpaired/excluded/fresh',
      'chromium:phone/signed-in/unpaired/excluded/stale-key',
      'webkit:board-no-view/signed-in/paired/excluded/fresh',
      'webkit:board-no-view/signed-in/paired/excluded/stale-key',
      'webkit:board-no-view/signed-in/revoked/excluded/fresh',
      'webkit:board-no-view/signed-in/revoked/excluded/stale-key',
      'webkit:board-no-view/signed-in/unpaired/excluded/fresh',
      'webkit:board-no-view/signed-in/unpaired/excluded/stale-key',
      'webkit:other-computer/signed-in/paired/excluded/fresh',
      'webkit:other-computer/signed-in/paired/excluded/stale-key',
      'webkit:other-computer/signed-in/revoked/excluded/fresh',
      'webkit:other-computer/signed-in/revoked/excluded/stale-key',
      'webkit:other-computer/signed-in/unpaired/excluded/fresh',
      'webkit:other-computer/signed-in/unpaired/excluded/stale-key',
      'webkit:phone/signed-in/paired/excluded/fresh',
      'webkit:phone/signed-in/paired/excluded/stale-key',
      'webkit:phone/signed-in/revoked/excluded/fresh',
      'webkit:phone/signed-in/revoked/excluded/stale-key',
      'webkit:phone/signed-in/unpaired/excluded/fresh',
      'webkit:phone/signed-in/unpaired/excluded/stale-key',
    ],
  },
  {
    item: 984,
    cause: "a board over the size limit shows as waiting for its first copy and the size limit is never named",
    cells: [
      'chromium:board-no-view/signed-in/paired/mixed/fresh',
      'chromium:board-no-view/signed-in/paired/oversize/fresh',
      'chromium:board-no-view/signed-in/paired/oversize/stale-key',
      'chromium:board-no-view/signed-in/unpaired/oversize/stale-key',
      'chromium:other-computer/signed-in/paired/mixed/fresh',
      'chromium:other-computer/signed-in/paired/oversize/fresh',
      'chromium:other-computer/signed-in/paired/oversize/stale-key',
      'chromium:other-computer/signed-in/unpaired/oversize/stale-key',
      'chromium:phone/signed-in/paired/mixed/fresh',
      'chromium:phone/signed-in/paired/oversize/fresh',
      'chromium:phone/signed-in/paired/oversize/stale-key',
      'chromium:phone/signed-in/unpaired/oversize/stale-key',
      'webkit:board-no-view/signed-in/paired/oversize/fresh',
      'webkit:board-no-view/signed-in/paired/oversize/stale-key',
      'webkit:board-no-view/signed-in/unpaired/oversize/stale-key',
      'webkit:other-computer/signed-in/paired/oversize/fresh',
      'webkit:other-computer/signed-in/paired/oversize/stale-key',
      'webkit:other-computer/signed-in/unpaired/oversize/stale-key',
      'webkit:phone/signed-in/paired/oversize/fresh',
      'webkit:phone/signed-in/paired/oversize/stale-key',
      'webkit:phone/signed-in/unpaired/oversize/stale-key',
    ],
  },
];

/** The filed defect that covers one failing cell, or undefined. */
function causeOf(key) {
  return CAUSES.find((cause) => cause.cells.includes(key));
}

/**
 * The matrix takes many minutes, so it runs as its own job (hosted-shapes in .github/workflows/gate.yml), never in
 * the landing gate or a submit's affected tests: only with this variable set.
 */
const OWN_JOB = process.env.PULLBOARD_HOSTED_SHAPES === '1';

/** How many unpaired cells one engine runs at once; each is its own browser context. */
const PARALLEL = 4;

/** The board ids and keys a linked project holds on this computer. */
function linkOf(box, root) {
  const state = JSON.parse(readFileSync(join(root, '.git', 'pullboard', 'relay.json'), 'utf8'));
  return { id: state.board, key: readFileSync(join(box.env.PULLBOARD_HOME, 'relay-keys', state.board + '.key'), 'utf8').trim() };
}

/**
 * Build one board state as a person would reach it, on its own relay account, and enroll then revoke one browser
 * per engine on the way, so the revoked identities are real.
 *
 * @param {import('node:test').TestContext} t
 * @param {string} boards
 * @param {{ name: string, context: object }[]} revokedIdentities - one browser context per engine, to be revoked
 * @param {object} front - the hosted front for this relay, created by the caller once the relay exists
 */
async function buildBoards(t, boards, engines) {
  const box = await relayClientFixture(t);
  box.env.PULLBOARD_MACHINE_HOME = box.env.PULLBOARD_HOME;
  const front = await hostedFront(box.origin);
  t.after(() => front.close());
  const revoked = {};
  const linked = [];
  /** Enroll this engine's revoked identity through the real relay on --all, then revoke it with relay revoke. */
  const enrollAndRevoke = async () => {
    for (const engine of engines) {
      const context = await engine.newContext();
      const session = await freshSession(box);
      let page;
      try {
        await relayOnAll(box, async (link) => {
          page = await context.newPage({ route: front.route(session, null) });
          await page.navigate(link);
        });
      } catch (error) {
        const seen = page ? await page.evaluate(READ_SCREEN).catch(() => null) : null;
        error.message += ` (enrolling ${engine.name}; its page showed ${JSON.stringify(seen)})`;
        throw error;
      }
      // relay on --all returns only once this browser enrolled and received its board keys.
      await page.close();
      const [device] = enrolledDevices(box);
      await revokeDevice(box, device);
      revoked[engine.name] = { context, session };
    }
  };
  if (boards === 'excluded') {
    assert.equal((await box.cli('relay', 'off')).code, 0, 'relay off excludes the board');
    await relayOnAll(box);
  }
  if (boards === 'healthy') { await enrollAndRevoke(); linked.push(linkOf(box, box.root)); }
  if (boards === 'oversize') {
    box.legacySnapshotApi('bad-route');
    box.rejectSnapshots({ status: 400, code: 'BAD_REQUEST', message: 'the body exceeds 14000000 bytes; send a smaller snapshot' });
    await enrollAndRevoke();
    linked.push(linkOf(box, box.root));
  }
  if (boards === 'approval') {
    await enrollAndRevoke();
    linked.push(linkOf(box, box.root));
    // The owner's own phone holds the approval card; the browsers under test are other browsers.
    await enrollProtocolPhone(box);
    const waiting = await siblingProject(box, 'notes', 'fixture/notes');
    const machine = JSON.parse(readFileSync(join(box.env.PULLBOARD_HOME, 'relay-machine/state.json'), 'utf8'));
    assert.ok(machine.approvals.some((entry) => entry.root === waiting && entry.published), 'the new project waits for a phone approval');
  }
  if (boards === 'mixed') {
    const big = await siblingProject(box, 'big', 'fixture/big');
    const skipped = await siblingProject(box, 'skipped', 'fixture/skipped');
    assert.equal((await box.cliAt(skipped, 'relay', 'off')).code, 0, 'one project is excluded');
    await enrollAndRevoke();
    box.legacySnapshotApi('bad-route');
    box.rejectSnapshots({ status: 400, code: 'BAD_REQUEST', message: 'the body exceeds 14000000 bytes; send a smaller snapshot' });
    assert.equal((await box.cliAt(big, 'relay', 'on', '--url', box.origin)).code, 0, 'the big project links, paused for size');
    linked.push(linkOf(box, box.root), linkOf(box, big));
  }
  const view = await boardView(box);
  t.after(() => view.stop());
  return { box, front, view, revoked, linked, unpairedSession: await freshSession(box), pairedSession: await freshSession(box) };
}

/** Run every cell of one board state in one engine; returns the failures as cell id -> reason, with timings. */
async function runCells(engine, built, boardCells, report, ineffective) {
  const { front, view, revoked, linked } = built;
  const keys = Object.fromEntries(linked.map(({ id, key }) => [id, key]));
  const boardIds = linked.map(({ id }) => id);
  const failures = {};
  /** Visit one cell in the given identity's context. */
  const one = async (cell, context, session) => {
    const want = expected(cell);
    const browser = impossibility(cell)?.runsAs.browser ?? cell.browser;
    const bootstrap = storedScript(cell.stored, { keys: browser === 'paired' ? keys : null, boards: boardIds });
    const route = front.route(cell.account === 'signed-in' ? session : null, cell.where === 'board-view' ? view.base : null);
    let seen;
    try { seen = await visit(context, { route, phone: cell.where === 'phone', bootstrap,
      localView: cell.where === 'board-view' ? built.view.base + '/local/view' : null }, want.board); }
    catch (error) { seen = { board: false, approval: false, words: 'visit failed: ' + error.message, commands: [], signIn: false, ms: null }; }
    let problem = judge(cell, seen, ineffective);
    // A board that arrived but over the bar is measured once more: one slow sample on a loaded machine is noise, two
    // are a finding. Both timings are reported.
    // A board still loading at the ceiling (a blank or 'Finding your boards' screen) is likewise measured once more.
    if (problem?.startsWith('the board took') || problem?.startsWith('the board did not show') && (!seen.words || /finding your boards|checking your/iu.test(seen.words))) {
      const again = await visit(context, { route, phone: cell.where === 'phone', bootstrap }, want.board).catch(() => null);
      if (again) { seen = { ...again, words: again.words, firstMs: seen.ms }; problem = judge(cell, seen, ineffective); }
    }
    report.push({ engine: engine.name, cell: cell.id, ok: !problem, problem, ms: seen.ms, firstMs: seen.firstMs ?? null, words: seen.words.slice(0, 300), commands: seen.commands });
    if (problem) failures[cell.id] = problem;
  };
  const unpaired = boardCells.filter((cell) => (impossibility(cell)?.runsAs.browser ?? cell.browser) === 'unpaired');
  for (let at = 0; at < unpaired.length; at += PARALLEL) {
    await Promise.all(unpaired.slice(at, at + PARALLEL).map(async (cell) => {
      const context = await engine.newContext();
      try { await one(cell, context, built.unpairedSession); } finally { await context.close(); }
    }));
  }
  // A paired browser keeps its keys in its own storage, so each stored state gets its own paired context, and the
  // cells within one run in turn; the revoked browser is the one enrolled browser, so its cells run in turn too.
  const pairedCells = boardCells.filter((entry) => !impossibility(entry) && entry.browser === 'paired');
  const revokedRun = (async () => {
    for (const cell of boardCells.filter((entry) => !impossibility(entry) && entry.browser === 'revoked')) {
      await one(cell, revoked[engine.name].context, revoked[engine.name].session);
    }
  })();
  await Promise.all(STORED.map(async (stored) => {
    const paired = await engine.newContext();
    try { for (const cell of pairedCells.filter((entry) => entry.stored === stored)) await one(cell, paired, built.pairedSession); }
    finally { await paired.close(); }
  }));
  await revokedRun;
  return failures;
}

test('a board awaiting a phone approval is mentioned on a non-phone paired browser [H5]', {
  timeout: 180_000,
}, async (t) => {
  if (!hostedEngines().some((engine) => engine.name === 'chromium' && engine.available)) return t.skip('Chrome is not installed; set PULLBOARD_CHROME');
  const engine = await openEngine('chromium');
  t.after(() => engine.close());
  const built = await buildBoards(t, 'approval', [engine]);
  const keys = Object.fromEntries(built.linked.map(({ id, key }) => [id, key]));
  const boards = built.linked.map(({ id }) => id);
  const context = await engine.newContext();
  t.after(() => context.close());
  const seen = await visit(context, {
    route: built.front.route(built.pairedSession, null), phone: false,
    bootstrap: storedScript('fresh', { keys, boards }),
  }, true);
  assert.equal(judge({ where: 'other-computer', account: 'signed-in', browser: 'paired', boards: 'approval', stored: 'fresh' }, seen), null, seen.words);
});

test('every listed cause is a filed item covering real cells, each cell once [H5,C7]', () => {
  const all = new Set(cells().flatMap((cell) => ['chromium', 'webkit'].map((engine) => `${engine}:${cell.id}`)));
  const seen = new Set();
  for (const cause of CAUSES) {
    assert.ok(Number.isSafeInteger(cause.item) && cause.item > 0 && cause.cause, 'each cause names its filed item and why');
    for (const key of cause.cells) {
      assert.ok(all.has(key), `${key} is a cell of the matrix`);
      assert.equal(seen.has(key), false, `${key} has one cause`);
      seen.add(key);
    }
  }
});

test('the header lists every cell and the screen it must reach [H5,H17,N26]', () => {
  const source = readFileSync(new URL(import.meta.url), 'utf8');
  const listed = source.slice(source.indexOf(' * CELLS-START\n') + ' * CELLS-START\n'.length, source.indexOf(' * CELLS-END'));
  assert.equal(cells().length, 4 * 2 * 3 * 6 * 3, 'the matrix is every combination');
  assert.equal(listed, cells().map(headerLine).join('\n') + '\n', 'the header lists every cell with its screen; regenerate it from headerLine when the matrix changes');
});

test('the matrix runs as its own job, outside the landing gate [H5,C7]', () => {
  const workflow = readFileSync(new URL('../.github/workflows/gate.yml', import.meta.url), 'utf8');
  const job = workflow.match(/\n  hosted-shapes:\n([\s\S]*?)\n  [a-z-]+:\n/u)?.[1];
  assert.ok(job, 'gate.yml has a hosted-shapes job beside the gate’s test jobs');
  assert.match(job, /if: github\.ref == 'refs\/heads\/main' && github\.event_name != 'pull_request'/u);
  assert.match(job, /run: npm run hosted-shapes/u);
  assert.equal(workflow.match(/npm run hosted-shapes|PULLBOARD_HOSTED_SHAPES|hosted-shapes\.test\.js/gu).length, 1, 'no other job runs the matrix');
  const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts;
  assert.equal(scripts['hosted-shapes'], 'PULLBOARD_HOSTED_SHAPES=1 node bin/run-tests.js test/hosted-shapes.test.js', 'one script runs the matrix as its own job');
  assert.equal(/hosted-shapes|PULLBOARD_HOSTED_SHAPES/u.test(scripts.gate + scripts.test), false, 'the gate and npm test never set it');
});

for (const boards of BOARDS) {
  test(`every shape opens or names its blocker: ${boards} [H5,H17,N26]`, {
    timeout: 900_000, // budget: hang ceiling for one board state's setup and both engines' cells.
    skip: !OWN_JOB && 'the matrix runs as its own job: set PULLBOARD_HOSTED_SHAPES=1, as the hosted-shapes job does',
  }, async (t) => {
    const available = hostedEngines().filter((engine) => engine.available);
    for (const engine of hostedEngines().filter((entry) => !entry.available)) t.diagnostic(`${engine.name} column skipped: ${engine.reason}`);
    if (!available.length) return t.skip('no browser on this machine');
    const engines = [];
    for (const { name } of available) engines.push(await openEngine(name));
    t.after(async () => { for (const engine of engines) await engine.close(); });
    const started = Date.now();
    const built = await buildBoards(t, boards, engines);
    t.diagnostic(`${boards}: setup ${Date.now() - started} ms`);
    const boardCells = cells().filter((cell) => cell.boards === boards);
    // The pairing step the page offers an unpaired browser, run once for real in the first engine: pairing is the
    // CLI's and the relay's, not the browser's. If it does not open the board, offering it does not clear the blocker.
    const clears = built.linked.length ? await relayPairClears(built.box, engines[0], built.front, built.unpairedSession) : null;
    t.diagnostic(`${boards}: pullboard relay pair ${clears === null ? 'not offered' : clears ? 'opens the board' : 'does not open the board'}`);
    const ineffective = clears === false ? ['pullboard relay pair'] : [];
    const report = [];
    const unexpected = [];
    // The engines run side by side: separate browsers and contexts, one relay and one view.
    const results = await Promise.all(engines.map(async (engine) => {
      const ran = Date.now();
      const failures = await runCells(engine, built, boardCells, report, ineffective);
      t.diagnostic(`${boards} ${engine.name}: ${boardCells.length} cells in ${Date.now() - ran} ms, ${Object.keys(failures).length} failing`);
      return { engine, failures };
    }));
    for (const { engine, failures } of results) {
      for (const cell of boardCells) {
        const key = `${engine.name}:${cell.id}`;
        const cause = causeOf(key);
        if (failures[cell.id] && !cause) unexpected.push(`${key}: ${failures[cell.id]}`);
        if (!failures[cell.id] && cause) unexpected.push(`${key} now passes; remove it from #${cause.item}'s cells`);
      }
    }
    if (process.env.PULLBOARD_SHAPES_REPORT) {
      const { appendFileSync } = await import('node:fs');
      for (const row of report) appendFileSync(process.env.PULLBOARD_SHAPES_REPORT, JSON.stringify({ boards, ...row }) + '\n');
    }
    assert.deepEqual(unexpected, [], 'every cell shows its board or names its blocker, or is a filed defect');
  });
}
