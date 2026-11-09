# -*- coding: utf-8 -*-
"""Original prose used to build the test fixtures (written for this project,
no third-party text). Markup inside paragraphs: *italic*, **bold**.
A block that is a dict {"break": "***"} is a scene break as typed by the author.
"""

NOVEL_ES = {
    "title": "La casa de los relojes",
    "author": "Marta Vidal",
    "lang": "es",
    "chapters": [
        {
            "heading": ["Capítulo 1", "La llegada"],
            "kind": "style",  # real Heading 1 / Heading 2 styles
            "blocks": [
                "Llegué a Vilanova un martes de noviembre, cuando el tren ya no traía a nadie y la estación olía a hierro mojado. Mi tía Remei me esperaba en el andén con un paraguas negro que no abrió en ningún momento, aunque llovía con una insistencia casi personal.",
                "—¿Eres Clara? —preguntó, sin acercarse.",
                "—La misma —respondí, y enseguida me arrepentí del tono, porque ella no sonrió.",
                "Caminamos por calles estrechas que subían hacia la parte vieja del pueblo. Las fachadas tenían balcones de hierro forjado y persianas de madera descoloridas por el salitre. Remei andaba deprisa, con pasos cortos y precisos, como si contara cada adoquín para no perder la cuenta de algo más importante.",
                "La casa estaba al final de la calle de les Hores, un nombre que entonces me pareció una casualidad simpática. Era un edificio alto y estrecho, con tres pisos y una puerta verde llena de arañazos. Encima del dintel, alguien había tallado una inscripción en latín: *tempus fugit, memoria manet*.",
                "Dentro, el silencio no era silencio. Era un murmullo continuo, un tictac multiplicado que venía de todas partes y de ninguna. Conté once relojes solo en el recibidor: de pared, de sobremesa, de cuco, un reloj de pie con la caja de nogal y un péndulo dorado que se movía con una lentitud majestuosa.",
                "—Tu abuelo los coleccionaba —dijo Remei—. Yo me limito a darles cuerda. Todos los domingos, a las seis de la tarde. No lo olvides nunca.",
                "No entendí por qué debía recordarlo yo, que solo pensaba quedarme un par de semanas, hasta que se resolviera el asunto de la herencia y pudiera volver a Madrid con una firma en el bolsillo y la conciencia tranquila.",
                {"break": "***"},
                "Aquella noche no conseguí dormir. Mi habitación estaba en el segundo piso, encima del taller, y a través de las tablas del suelo me llegaba el rumor de los mecanismos. A las tres y diecisiete, todos los relojes se detuvieron a la vez.",
                "El silencio fue tan absoluto que oí mi propio pulso. Me incorporé en la cama, convencida de que había soñado el cambio, pero no: el mundo entero parecía contener la respiración. Después, exactamente un minuto más tarde, el tictac volvió a empezar, como si nada hubiera pasado.",
                "Por la mañana se lo conté a Remei mientras ella untaba tomate en el pan con una concentración absoluta.",
                "—¿A las tres y diecisiete? —repitió, sin levantar la vista—. Entonces ya ha empezado.",
                "—¿Qué ha empezado?",
                "Pero mi tía se limitó a encogerse de hombros y a servirme un café tan negro y tan espeso que parecía una amenaza.",
            ],
        },
        {
            "heading": ["CAPÍTULO 2", "Los relojes"],
            "kind": "fake",  # typed as bold, centred, big text in the Normal style
            "blocks": [
                "El taller del abuelo Ernest ocupaba toda la planta baja. Había una mesa larga cubierta de herramientas diminutas, lupas con brazos articulados, frascos de aceite con etiquetas escritas a mano y cajones que se abrían con un chirrido de protesta. En las paredes colgaban esferas sin agujas, como caras a las que alguien hubiera borrado la expresión.",
                "Pasé la mañana ordenando papeles. Facturas de proveedores de Ginebra y de Besançon, cartas de clientes de media Europa, catálogos de subastas con páginas marcadas en rojo. Mi abuelo había sido, según descubrí con cierta sorpresa, un relojero respetado en el mundo **franco-suizo** de la alta relojería, un hombre al que consultaban desde París cuando un mecanismo antiguo se negaba a funcionar.",
                "Entre los papeles encontré un cuaderno de tapas de hule, con la letra apretada y elegante del abuelo. No era un registro de reparaciones. Era otra cosa. Cada página llevaba una fecha y una hora, siempre las tres y diecisiete, y debajo una frase breve: *Ha vuelto a ocurrir. Esta vez ha durado más.*",
                "La primera entrada era de 1974. La última, de hacía apenas seis meses, una semana antes de que muriera.",
                "—Remei —llamé, con el cuaderno en la mano—. ¿Tú sabías esto?",
                "Mi tía apareció en el umbral secándose las manos en el delantal. Miró el cuaderno durante un rato largo, y por primera vez desde mi llegada me pareció que dudaba.",
                "—Tu abuelo decía que la casa tiene su propio tiempo —contestó al fin—. Que los relojes no lo miden: lo contienen. Yo nunca he querido saber más. Hay preguntas que, una vez hechas, ya no se pueden deshacer.",
                {"break": "*"},
                "Esa tarde fui al archivo municipal. La archivera, una mujer joven con gafas redondas y un jersey de lana gruesa, me escuchó con una paciencia admirable mientras yo intentaba explicar qué buscaba sin parecer una loca.",
                "—¿Algo que pasara en esta calle a las tres y diecisiete? —resumió—. Bueno, no es la consulta más rara que me han hecho este año. Déjame mirar.",
                "Volvió al cabo de media hora con una carpeta azul y una expresión indescifrable. Dentro había un recorte de periódico de marzo de 1974: «Desaparece sin dejar rastro un vecino de la calle de les Hores». El vecino se llamaba Andreu Soler. Era el aprendiz de mi abuelo.",
            ],
        },
        {
            "heading": ["Capítulo 3: El sótano"],
            "kind": "style",
            "blocks": [
                "La puerta del sótano estaba detrás de una cortina de terciopelo granate, al fondo del taller. No tenía cerradura, solo un pestillo oxidado que cedió al segundo intento con un quejido metálico. Una escalera de piedra descendía hacia una oscuridad que olía a tierra y a aceite viejo.",
                "Bajé con la linterna del móvil, contando los escalones. Diecisiete. Por supuesto que eran diecisiete.",
                "Abajo había un único reloj, enorme, encastrado en la pared como si la casa hubiera crecido a su alrededor. La esfera debía de medir dos metros de diámetro y las agujas, de bronce ennegrecido, marcaban las tres y diecisiete. No se movían. Bajo la esfera, grabada en la piedra, leí la misma inscripción de la entrada, con una palabra añadida: *tempus fugit, memoria manet, amor redit*.",
                "Apoyé la mano en el cristal. Estaba tibio.",
                "No sé cuánto tiempo estuve allí. Recuerdo que pensé en mi madre, que nunca quiso hablar de esta casa, y en las cartas que el abuelo me enviaba cada cumpleaños y que yo nunca contesté. Recuerdo que sentí una tristeza extraordinariamente concreta, como un objeto que se pudiera sostener en la palma de la mano.",
                "Cuando subí, Remei me esperaba en el taller con dos tazas de chocolate caliente.",
                "—Lo has visto —dijo. No era una pregunta.",
                {"break": "#"},
                "Los días siguientes los dediqué a reconstruir la historia. Andreu Soler había entrado en el taller a los quince años; era, según las cartas, un muchacho de manos prodigiosas y carácter imposible. El abuelo lo quería como a un hijo. En el cuaderno, la primera entrada decía: *Andreu ha bajado. No ha vuelto a subir. Los relojes se han parado.*",
                "Fui comprendiendo que mi abuelo había pasado cincuenta años intentando abrir de nuevo una puerta que no era una puerta, esperando cada noche a las tres y diecisiete, dando cuerda a cada reloj de la casa como quien mantiene encendida una vela en una ventana.",
            ],
        },
        {
            "heading": ["Epílogo"],
            "kind": "fake",
            "blocks": [
                "No vendí la casa. Remei dice que nunca pensó que lo haría, aunque yo recuerdo con claridad el billete de vuelta que llevaba en el bolso aquel primer martes de noviembre.",
                "Todos los domingos, a las seis de la tarde, doy cuerda a los relojes. Uno por uno, sin prisa, escuchando cómo el mecanismo responde a la llave con un pequeño suspiro de gratitud. Y cada noche, a las tres y diecisiete, bajo al sótano y espero.",
                "Hasta ahora no ha pasado nada. Pero el cristal sigue tibio, y a veces, si pego la oreja a la esfera, me parece oír, muy lejos, el tictac de otro reloj que responde.",
            ],
        },
    ],
    # Paragraph (chapter index, block index) that carries a footnote in the DOCX.
    "footnote": {"chapter": 1, "block": 1, "after": "alta relojería,",
                 "text": "Besançon fue durante siglos la capital relojera de Francia."},
}


BILINGUAL_CA_EN = {
    "title": "El far de les col·leccions",
    "author": "Jordi Pujol i Serra",
    "lang": "ca",
    "chapters": [
        {
            "heading": ["Capítol primer", "La tramuntana"],
            "kind": "style",
            "blocks": [
                "Feia tres dies que bufava la tramuntana i el poble semblava haver-se encongit sobre si mateix. Les barques estaven amarrades amb dobles caps, les finestres tancades amb balda i els gats havien desaparegut, com fan sempre que el vent decideix que el món li pertany.",
                "L'Anna pujava cada matí al far amb un cistell de pa, formatge i una ampolla de vi negre. El vell Miquel l'esperava a la porta, amb la gorra calada fins a les celles i aquell somriure torçat que feia servir per dissimular l'alegria.",
                "—Avui no hi ha col·lecció —va dir, assenyalant el mar embravit—. Amb aquest vent, l'aigua no porta res que valgui la pena.",
                "Miquel col·leccionava objectes que el mar retornava: ampolles amb missatges il·legibles, fragments de vaixells, una nina de porcellana sense cap, monedes rovellades d'imperis oblidats. Els guardava en vitrines de fusta al primer pis del far, etiquetats amb una cal·ligrafia minuciosa i una paciència il·limitada.",
                "L'Anna havia crescut entre aquelles vitrines. Coneixia la història de cada objecte, o almenys la història que en Miquel s'havia inventat, perquè ell sostenia que un objecte sense història no és més que una cosa, i que les coses no s'han de col·leccionar mai.",
                {"break": "* * *"},
                "Aquella tarda, quan el vent va amainar una mica, van baixar junts a la cala. Entre les algues i els troncs blanquejats hi havia una caixa metàl·lica, petita, segellada amb cera vermella. A la tapa, gravades amb lletres angleses, s'hi llegien dues paraules: *for Michael*.",
                "En Miquel es va quedar molt quiet. Després va recollir la caixa amb una delicadesa que l'Anna no li havia vist mai, com si dugués un ocell ferit.",
            ],
        },
        {
            "heading": ["Capítol segon", "La carta"],
            "kind": "style",
            "blocks": [
                "Dins la caixa hi havia una carta escrita en anglès, amb una lletra inclinada i elegant. En Miquel la va llegir en silenci i després la va passar a l'Anna, que havia estudiat anglès a l'institut i el parlava amb una confiança desproporcionada.",
            ],
        },
        {
            "heading": ["Letter from Brighton"],
            "kind": "style",
            "lang": "en",
            "blocks": [
                "Dear Michael, I do not know whether this letter will ever reach you, or whether the sea will keep it for itself, as it has kept so many things that belonged to us. I am writing from the same window where we used to watch the ferries leave for France, and I am thinking of the summer we spent pretending that the war was something happening to other people.",
                "You told me once that the sea never steals anything; it only borrows things for a while and gives them back when we have learned to deserve them. I did not believe you then. I am trying very hard to believe you now.",
                "I have kept the compass you gave me. It still points north, although I have long since stopped knowing where north is. If this box finds its way to your lighthouse, please know that I never stopped waiting, and that I forgave you a long time ago for the things neither of us had the courage to say.",
                "Yours, always, Eleanor.",
            ],
        },
        {
            "heading": ["Capítol tercer", "El retorn"],
            "kind": "style",
            "blocks": [
                "En Miquel no va dir res durant molta estona. Mirava per la finestra rodona del far, cap al nord, on el mar es confonia amb el cel en una línia grisa i indecisa.",
                "—Era a Brighton, l'any cinquanta-dos —va explicar finalment—. Jo hi treballava en un vaixell de càrrega. Ella venia flors al port. Vaig marxar sense acomiadar-me, perquè vaig pensar que era més fàcil així. Em vaig equivocar, és clar. Un s'equivoca sempre que pensa que una cosa difícil serà més fàcil si no la fa.",
                "L'Anna va col·locar la carta a la vitrina principal, al costat de la brúixola trencada que en Miquel guardava des de sempre i que mai no havia volgut explicar. Ara ja tenia història. Ara ja no era una cosa.",
                "Aquella nit, per primera vegada en molts anys, en Miquel va encendre el llum del far tot i que ja no navegava ningú per aquella costa. La llum girava lentament sobre el mar, constant i paral·lela a l'horitzó, com una pregunta que algú fa sense esperar resposta.",
            ],
        },
    ],
}


NOVEL_FR = {
    "title": "Les jardins de la rue Vauban",
    "author": "Hélène Marchetti",
    "lang": "fr",
    "chapters": [
        {
            "heading": ["Chapitre premier"],
            "blocks": [
                "Le premier matin, la pluie tombait si doucement sur Lyon qu'on aurait dit une hésitation. Madeleine ouvrit les volets de l'appartement de la rue Vauban et regarda la cour intérieure, où un vieux tilleul tendait ses branches nues vers les fenêtres comme pour demander la permission d'entrer.",
                "Elle avait hérité de cet appartement sans l'avoir demandé, d'une grand-tante qu'elle n'avait vue que deux fois. La lettre du notaire tenait en trois lignes : un nom, une adresse, une date de rendez-vous. Aucune explication. Les familles, pensa-t-elle, sont des romans dont on ne lit jamais que des chapitres isolés.",
                "« Vous êtes la petite-nièce ? » demanda la concierge en lui tendant les clés. Elle avait un accent chantant et des yeux d'un bleu presque transparent. « Madame Fontaine parlait souvent de vous. Elle disait que vous aviez ses mains. »",
                "Madeleine regarda ses mains, longues et un peu maladroites, et ne sut que répondre. Comment une femme qu'elle connaissait à peine pouvait-elle parler souvent d'elle ? Elle remercia, monta les quatre étages et resta longtemps immobile sur le palier, la clé à la main, comme devant une porte qui ouvrirait sur une autre vie.",
                "L'appartement sentait la cire, la lavande et quelque chose de plus ancien, de plus difficile à nommer : peut-être simplement le temps. Les murs étaient couverts d'aquarelles représentant des jardins. Des dizaines de jardins, tous différents, tous signés des mêmes initiales discrètes : *A. F.*",
            ],
        },
        {
            "heading": ["Chapitre II"],
            "blocks": [
                "Il lui fallut une semaine pour comprendre que ces jardins existaient réellement. Le premier qu'elle reconnut était celui du parc de la Tête d'Or, avec sa grande serre de verre et de fer ; le deuxième, un petit jardin de curé derrière une église de la Croix-Rousse.",
                "Elle se mit à les chercher tous, un carnet à la main, comparant chaque aquarelle aux lieux qu'elle visitait. Certains jardins avaient disparu, remplacés par des parkings ou des immeubles sans grâce. D'autres avaient survécu, transformés, méconnaissables, et pourtant identiques dans une certaine qualité de lumière.",
                "Le vieux jardinier du parc l'observa longtemps avant de s'approcher. « Vous cherchez quelque chose, mademoiselle ? » Elle lui montra l'aquarelle. Il la regarda, puis la regarda, elle, avec une attention nouvelle. « Ça, c'est le jardin d'Alice. Elle venait peindre ici tous les jeudis. Pendant quarante ans. »",
                {"break": "***"},
                "Ce soir-là, Madeleine ouvrit enfin le secrétaire qu'elle n'avait pas osé toucher. Elle y trouva des lettres, des factures de graines, des catalogues de pépinières, et un cahier d'écolier à la couverture bleue sur lequel était écrit, d'une écriture appliquée : *Pour Madeleine, quand elle sera prête.*",
                "Elle n'était pas prête. Elle ouvrit le cahier quand même.",
            ],
        },
        {
            "heading": ["Chapitre III"],
            "blocks": [
                "Le cahier ne racontait pas une histoire ; il en racontait cent. Chaque page correspondait à un jardin, et chaque jardin à un souvenir. Alice Fontaine y avait consigné, avec une précision extraordinaire, les gens qu'elle y avait croisés, les conversations surprises, les saisons, les orages, les premières violettes.",
                "Madeleine découvrit ainsi que sa grand-tante avait aimé, à vingt ans, un jeune botaniste italien qui était reparti à Turin sans laisser d'adresse ; qu'elle avait refusé trois demandes en mariage ; qu'elle avait enseigné le dessin dans une école de filles pendant trente-deux ans ; et qu'elle avait suivi, de loin, chaque étape de la vie de sa petite-nièce, grâce aux lettres d'une cousine bavarde.",
                "La dernière page était consacrée à un jardin qui n'existait pas encore. Une cour intérieure, un tilleul, des massifs de roses anciennes et un banc de pierre. En dessous, Alice avait écrit : « Celui-là, c'est à toi de le faire. »",
                "Madeleine leva les yeux vers la fenêtre. Dans la cour, le vieux tilleul attendait.",
            ],
        },
    ],
}


PLAIN_EN = {
    "title": "The Weather Office",
    "author": "Thomas Reid",
    "lang": "en",
    "chapters": [
        {
            "heading": ["CHAPTER ONE"],
            "blocks": [
                "Nobody in Pembury ever asked why the weather office stood at the end of the pier. It had always been there, a white wooden hut with a brass barometer bolted to the door and a sign that said, simply, \"Forecasts Within.\" Mr. Abernathy opened it every morning at seven and closed it every evening at six, and in between he told people what the sky intended to do.",
                "He was never wrong. That was the first strange thing about him, although it took the town a surprisingly long time to notice. Fishermen planned their days around his chalkboard; brides consulted him before choosing a date; the vicar, who disapproved of almost everything, was seen more than once lingering by the window to read the afternoon outlook.",
                "\"It's a matter of listening,\" Mr. Abernathy would say, if anybody asked. \"The weather isn't shy. It's simply polite. It waits to be asked.\"",
                "Lucy Hargreaves was eleven when she decided to find out what he meant. She had a notebook, a pencil, and the kind of stubbornness that her mother called a gift and her teachers called something else entirely.",
            ],
        },
        {
            "heading": ["CHAPTER TWO"],
            "blocks": [
                "The first week, she simply watched. She sat on the bench opposite the hut with her notebook open on her knees and wrote down everything Mr. Abernathy did: when he tapped the barometer, when he looked at the gulls, when he licked a finger and held it up into the wind -- which, she noticed, he did far less often than people assumed.",
                "The second week, he came out and sat beside her.",
                "\"You're doing it wrong,\" he said, not unkindly. \"You're watching me. You should be watching the sea.\"",
                {"break": "* * *"},
                "By the end of the summer, Lucy could tell a fog from a mist by the way the light sat on the water. She knew that the gulls flew inland a full hour before a squall, and that the old harbour wall sweated before a thunderstorm. She was right about the weather perhaps half the time, which Mr. Abernathy said was a great deal better than the BBC.",
                "On the last day of August, he gave her the key.",
            ],
        },
    ],
}


# Chapter titles that are only bold, left-aligned, body-sized lines in the
# Normal style, with no number: invisible to style/size/wording rules.
PLAIN_TITLES_EN = {
    "title": "The Salt Road",
    "author": "Nora Feld",
    "lang": "en",
    "chapters": [
        {
            "heading": ["The Harbour"],
            "kind": "boldleft",
            "blocks": [
                "The ferry arrived an hour late, which in that part of the coast counted as punctual. Ines stood at the rail with her suitcase between her feet and watched the town assemble itself out of the mist: a church, a row of yellow houses, a crane that had not moved in years.",
                "Nobody was waiting for her. She had expected that, and still it surprised her, the way a step that is not there surprises the foot. She carried the suitcase up the ramp herself and asked the first person she saw for the address on the envelope.",
                "The woman read it twice, looked at Ines with frank curiosity, and pointed up the hill without a word. It was, Ines would learn, the most anyone in that town ever said to a stranger on the first day.",
            ],
        },
        {
            "heading": ["Salt"],
            "kind": "boldleft",
            "blocks": [
                "The house belonged to the salt works, or had once. Its walls were white with something that was not paint, and when she touched them her fingers came away tasting of the sea. Inside, every surface held a thin crust of the same fine powder.",
                "Her grandfather had worked the pans for forty years. In the kitchen drawer she found his ledgers, columns of numbers in pencil that grew fainter towards the end, as if he had been pressing less and less hard on the world.",
                {"break": "***"},
                "In the evening she walked down to the flats. The pans lay in long rectangles under a sky the colour of pewter, and a single man was raking them in slow, patient strokes, pulling the salt into small white hills.",
            ],
        },
        {
            "heading": ["The Ledger"],
            "kind": "boldleft",
            "blocks": [
                "The man with the rake was called Tomas, and he had known her grandfather longer than anyone. He did not ask why she had come. He asked whether she could read the ledgers, and when she said she could, he nodded as if a debt had been settled.",
                "That night she read them all. The numbers were not only salt. In the margins, in a hand smaller than the rest, her grandfather had written the names of the boats that went out and the dates on which they came back, or did not.",
            ],
        },
        {
            "heading": ["What the Tide Keeps"],
            "kind": "boldleft",
            "blocks": [
                "She stayed through the winter. She learned to rake, badly at first and then well enough, and to read the weather from the colour of the brine. Tomas never praised her, which she understood eventually to be the highest praise he had.",
                "In spring she wrote the last line in the ledger herself, in pencil, pressing hard. It was a name and a date, and beside it, for the first time in that long column, the word returned.",
            ],
        },
    ],
}


# A typeset book: drop caps, a letter set smaller and indented, a numbered
# list with a hanging indent, chapter titles whose font loses glyphs (drawn
# partly as images) and PDF bookmarks carrying the real titles.
TYPESET_EN = {
    "title": "The Lighthouse Keeper's Daughter",
    "author": "Ada Morrow",
    "lang": "en",
    "chapters": [
        {
            "heading": ["Chapter One"],
            "blocks": [
                "Mara learned to read by the light of the lamp her father tended, and so for the rest of her life she associated words with the smell of paraffin and the slow turning of a great glass eye above her head. She read whatever the supply boat brought: almanacs, seed catalogues, a water-stained atlas with half of Africa missing.",
                "Her father did not read. He listened, though, every evening after the lamp was lit, while she read aloud from whatever she had, and he would nod at the hard words as if greeting old acquaintances on the quay.",
                "When she was twelve, a letter came for him. It was the first letter either of them could remember, and he held it for a long time before giving it to her to open.",
                {"quote": [
                    "Dear Mr Morrow, we regret to inform you that the light on the north rock is to be automated before the end of the year.",
                    "Your service has been exemplary. A cottage on the mainland will be made available to you and your daughter.",
                    "Yours faithfully, the Commissioners.",
                ]},
                "Her father folded the letter into four and put it in his breast pocket, where it stayed for the rest of the winter, a small square bulge over his heart.",
            ],
        },
        {
            "heading": ["Chapter Two"],
            "blocks": [
                "Leaving took longer than either of them expected. There were the logbooks to copy, the brass to polish one last time, and the long argument with the gulls, who had come to regard the gallery as their own and did not intend to give it up without a fight.",
                "Mara made a list on the back of the last page of the atlas. She called it the list of things that could not be packed:",
                {"list": [
                    "1. The sound of the foghorn at four in the morning, which she had hated for years and now could not imagine sleeping without.",
                    "2. The view from the gallery at dusk, when the mainland looked like a rumour.",
                    "3. Her father as he was here, certain of every step on the spiral stair.",
                ]},
                "She did not show him the list. She suspected he had one of his own, unwritten, and longer.",
            ],
        },
        {
            "heading": ["Chapter Three"],
            "blocks": [
                "The cottage on the mainland had electric light and a kitchen tap and neighbours who waved. Her father kept the lamp oil in the shed anyway, a dozen tins of it, and on clear nights he walked down to the harbour wall and stood watching the north rock, where the new light turned without anyone at all.",
                "Mara went to school, where she discovered that other children had read the other half of Africa. She was not impressed. She had read the sea.",
            ],
        },
    ],
}
