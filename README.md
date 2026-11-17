# The Canon

A four-year bucket list that a campus writes for itself. The top of the book moves. A finish is hard to fake.

Students propose items and vote them into this week's top five. The votes clear every Monday at midnight, campus time, and whatever is still on top is that week's list. Proposals that finish the week there join the book. A proposal has to use a real campus place. It cannot drop a pin on a friend's room.

Finishing an item is separate from voting for it.

## How a finish counts

The phone has to be inside the place, during that item's window. Sunrise at East Rock opens for twenty minutes on either side of sunrise. The Game opens only while that game is being played, once at the Bowl and once at Harvard. The dining-hall day opens during meal hours and needs every college hall on the same campus day. The snow item opens only when it is actually snowing on campus. A sealed item stays off the public ranking until someone finishes it. The title stays visible, so a first person can do it.

The camera is live. A photo from the gallery cannot be submitted. The page has no upload control.

A second phone has to be at that place within a minute and type the code from the first phone. That pair can confirm each other three times. After that, their confirmations stop counting. A friend with a loyal thumb wears out.

Hosted items skip the friend. A master's tea, a rehearsal, and a meal with a professor count when the host marks you present, and the host's phone has to be at the place too.

The proof then sits for a day, with the photos, where other colleges can see it. A challenge from one college is only a flag. A second college strikes the item. Both the student and the witness, or the host, lose standing. At zero standing, further finishes do not count.

The location check is a yes or no against the place. The coordinates are not stored. The book keeps the place name, the time, and the live photos.

## This week

Anyone enrolled can propose one item at a time, and can vote once on each item except their own proposal. The five with the most votes are the top of the book. On Monday the counts go back to zero, so last week's winners do not sit there forever. The page says when the next clear is.

Sign-in is Yale's own NetID page, [Central Authentication Service](https://secure.its.yale.edu/cas/login). The password is entered there and never sent to this book. After Yale redirects back, the server checks the ticket with Yale and refuses the session unless the reply names the person as a student. Faculty, staff, and affiliate NetIDs stay out. Yale only releases that student fact, and only accepts the callback, after Identity and Access Management registers the service URL.

The fourteen residential colleges, as published by [Yale Housing](https://housing.yale.edu/undergraduate-housing/residential-colleges), are Benjamin Franklin, Berkeley, Branford, Davenport, Ezra Stiles, Grace Hopper, Jonathan Edwards, Morse, Pauli Murray, Pierson, Saybrook, Silliman, Timothy Dwight, and Trumbull. A student chooses theirs once. It cannot be switched from the page.

A head of college or professor who should mark hosted items is named in `data/hosts.json`, by item id and NetID. Until a NetID is named, no one can stamp that hosted item.

## The sample book

- Eat in every dining hall in one day.
- Stay for a full lecture in a department you will never major in.
- Watch the sun come up from East Rock.
- Go to a master's tea in a college that is not yours.
- Be in the stands for The Game at home and away.
- Leave a note in a library book.
- Walk out of Sterling into the first snow.
- Have a meal with a professor you do not have class with.
- Show up for one rehearsal in an art you do not practice.
- In your last semester, do the thing seniors in your college say they regret skipping.

Fences are approximate campus points, tight enough that a check-in from across town fails.

## This repo

| Path | What it is |
| --- | --- |
| `index.html` | The book |
| `styles.css` | The page |
| `app.js` | The camera, the place check, and the screen |
| `canon.js` | Places, people, and the starting items |
| `rules.js` | Votes, windows, pairs, challenges, standing |
| `rules.test.js` | The rules, without a browser |
| `server.js` | Yale sign-in, the session, and the book |

From this folder, run `node server.js` and open `http://127.0.0.1:8765`. Register that exact callback, `http://127.0.0.1:8765/auth/callback`, with Yale if you are signing in from this machine. The rules alone can be checked with `node rules.test.js`.
