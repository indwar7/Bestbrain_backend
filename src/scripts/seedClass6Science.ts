/**
 * Seeds the Class 6 Science question bank and two sample homework assignments,
 * so Learn has something real behind every chapter rather than ten empty
 * modules.
 *
 * Idempotent: a question is identified by (className, subject, chapterSlug,
 * text), and homework by (className, subject, title). Re-running adds what is
 * missing and touches nothing else, so it is safe to run against an
 * environment that already has data, which is the only way a seed script is
 * useful more than once.
 *
 * Run with: npm run seed:class6science
 */
import mongoose from "mongoose";
import { connectDB } from "../config/db";
import { Question } from "../models/Question";
import { Homework } from "../models/Homework";
import { User } from "../models/User";

const CLASS = "Class 6";
const SUBJECT = "Science";

type Seed = {
  text: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  difficulty: "easy" | "medium" | "hard";
};

// The ten Class 6 Science chapters, keyed by the slug Learn uses. These must
// match the inline CURRICULUM in learn.html and the shared curriculum.js.
const BANK: Record<string, Seed[]> = {
  "food-sources": [
    { text: "Which of these is a plant source of food?", options: ["Milk", "Egg", "Wheat", "Fish"], correctIndex: 2, explanation: "Wheat is a cereal obtained from a plant; the others come from animals.", difficulty: "easy" },
    { text: "Honey is obtained from which source?", options: ["Plants directly", "Bees", "Cattle", "Hens"], correctIndex: 1, explanation: "Bees collect nectar from flowers and turn it into honey.", difficulty: "easy" },
    { text: "Animals that eat only plants are called?", options: ["Carnivores", "Herbivores", "Omnivores", "Scavengers"], correctIndex: 1, explanation: "Herbivores such as cows and goats eat only plant material.", difficulty: "easy" },
    { text: "Which part of the mustard plant gives us oil?", options: ["Leaves", "Roots", "Seeds", "Stem"], correctIndex: 2, explanation: "Mustard seeds are pressed to extract mustard oil.", difficulty: "medium" },
    { text: "A tiger is a carnivore because it?", options: ["Eats only plants", "Eats other animals", "Eats both", "Eats dead animals only"], correctIndex: 1, explanation: "Carnivores feed on the flesh of other animals.", difficulty: "easy" },
    { text: "Which of these is an animal product?", options: ["Rice", "Paneer", "Pulses", "Sugar"], correctIndex: 1, explanation: "Paneer is made from milk, which comes from animals.", difficulty: "easy" },
    { text: "Sprouted seeds are considered healthy because sprouting?", options: ["Removes all water", "Increases nutrient value", "Adds sugar", "Adds fat"], correctIndex: 1, explanation: "Germination increases the vitamin content of the seed.", difficulty: "medium" },
    { text: "Which part of a banana plant is eaten as a vegetable?", options: ["Only the fruit", "The stem and flower too", "The roots", "The leaves"], correctIndex: 1, explanation: "Banana stem and flower are both cooked as vegetables in India.", difficulty: "medium" },
    { text: "Crows and cockroaches that feed on dead remains are called?", options: ["Herbivores", "Scavengers", "Producers", "Autotrophs"], correctIndex: 1, explanation: "Scavengers clean up dead and decaying matter.", difficulty: "medium" },
    { text: "Which of these animals is an omnivore?", options: ["Cow", "Lion", "Crow", "Deer"], correctIndex: 2, explanation: "Crows eat both plant matter and small animals.", difficulty: "medium" },
    { text: "The main ingredient of idli batter is?", options: ["Wheat and milk", "Rice and urad dal", "Maize and oil", "Ragi and sugar"], correctIndex: 1, explanation: "Idli is made by fermenting a rice and urad dal batter.", difficulty: "hard" },
    { text: "Nectar collected by bees is obtained from?", options: ["Roots", "Flowers", "Bark", "Seeds"], correctIndex: 1, explanation: "Nectar is the sugary liquid produced by flowers.", difficulty: "easy" },
  ],
  "components-of-food": [
    { text: "Which nutrient gives the body most of its energy?", options: ["Proteins", "Carbohydrates", "Vitamins", "Minerals"], correctIndex: 1, explanation: "Carbohydrates are the body's main and quickest energy source.", difficulty: "easy" },
    { text: "Scurvy is caused by a deficiency of which vitamin?", options: ["Vitamin A", "Vitamin B1", "Vitamin C", "Vitamin D"], correctIndex: 2, explanation: "Too little Vitamin C causes scurvy, bleeding gums and slow healing.", difficulty: "medium" },
    { text: "Proteins are called ____ because they help the body grow.", options: ["Energy giving", "Body building", "Protective", "Roughage"], correctIndex: 1, explanation: "Proteins build and repair body tissue, so they are body-building foods.", difficulty: "easy" },
    { text: "Which test is used to detect starch in food?", options: ["Copper sulphate test", "Iodine test", "Litmus test", "Flame test"], correctIndex: 1, explanation: "Iodine turns blue-black in the presence of starch.", difficulty: "medium" },
    { text: "Roughage (dietary fibre) mainly helps to?", options: ["Give energy", "Build muscle", "Move food through the gut", "Strengthen bones"], correctIndex: 2, explanation: "Fibre adds bulk and helps the body get rid of undigested food.", difficulty: "medium" },
    { text: "Deficiency of iron in the diet causes?", options: ["Rickets", "Anaemia", "Goitre", "Beri-beri"], correctIndex: 1, explanation: "Iron is needed to make haemoglobin; too little causes anaemia.", difficulty: "medium" },
    { text: "Which vitamin is made by our skin in sunlight?", options: ["Vitamin A", "Vitamin C", "Vitamin D", "Vitamin K"], correctIndex: 2, explanation: "Sunlight on skin lets the body make Vitamin D.", difficulty: "easy" },
    { text: "Goitre is caused by the deficiency of?", options: ["Iron", "Calcium", "Iodine", "Phosphorus"], correctIndex: 2, explanation: "Iodine deficiency causes the thyroid gland to swell, goitre.", difficulty: "medium" },
    { text: "A balanced diet is one that?", options: ["Has only proteins", "Has all nutrients in right amounts", "Has no fat at all", "Is only vegetarian"], correctIndex: 1, explanation: "A balanced diet supplies every nutrient in the quantity the body needs.", difficulty: "easy" },
    { text: "Which of these is the richest source of fat?", options: ["Butter", "Spinach", "Orange", "Rice"], correctIndex: 0, explanation: "Butter is almost entirely fat.", difficulty: "easy" },
    { text: "Night blindness is caused by a lack of?", options: ["Vitamin A", "Vitamin C", "Iron", "Calcium"], correctIndex: 0, explanation: "Vitamin A is needed for vision in dim light.", difficulty: "medium" },
    { text: "The disease caused by deficiency of Vitamin B1 is?", options: ["Scurvy", "Beri-beri", "Rickets", "Anaemia"], correctIndex: 1, explanation: "Beri-beri results from too little Vitamin B1 (thiamine).", difficulty: "hard" },
  ],
  "fibre-to-fabric": [
    { text: "Cotton fibre is obtained from which part of the plant?", options: ["Roots", "Stem", "Bolls (fruit)", "Leaves"], correctIndex: 2, explanation: "Cotton comes from the fluffy bolls that form after flowering.", difficulty: "easy" },
    { text: "Which of these is a synthetic fibre?", options: ["Jute", "Wool", "Nylon", "Silk"], correctIndex: 2, explanation: "Nylon is made in a factory; the rest are natural fibres.", difficulty: "easy" },
    { text: "The process of making yarn from fibres is called?", options: ["Weaving", "Spinning", "Knitting", "Ginning"], correctIndex: 1, explanation: "Spinning draws and twists fibres into a continuous yarn.", difficulty: "easy" },
    { text: "Removing seeds from cotton is called?", options: ["Ginning", "Retting", "Spinning", "Weaving"], correctIndex: 0, explanation: "Ginning separates cotton fibre from its seeds.", difficulty: "medium" },
    { text: "Silk fibre is obtained from?", options: ["Sheep", "Silkworm cocoon", "Cotton plant", "Jute stem"], correctIndex: 1, explanation: "Silk is unwound from the cocoon spun by the silkworm.", difficulty: "easy" },
    { text: "Jute is mainly obtained from the ____ of the plant.", options: ["Fruit", "Stem", "Root", "Flower"], correctIndex: 1, explanation: "Jute fibre comes from the stem, separated by retting.", difficulty: "medium" },
    { text: "Two sets of yarn arranged together to make fabric is called?", options: ["Knitting", "Weaving", "Spinning", "Dyeing"], correctIndex: 1, explanation: "Weaving interlaces two sets of yarn on a loom.", difficulty: "medium" },
    { text: "A single yarn used to make fabric by forming loops is?", options: ["Weaving", "Knitting", "Ginning", "Retting"], correctIndex: 1, explanation: "Knitting uses one continuous yarn looped together.", difficulty: "medium" },
    { text: "Wool is obtained from?", options: ["Silkworm", "Sheep", "Cotton", "Coconut"], correctIndex: 1, explanation: "Wool is the fleece of sheep and some other animals.", difficulty: "easy" },
    { text: "The device used at home for spinning yarn is?", options: ["Loom", "Takli", "Gin", "Kiln"], correctIndex: 1, explanation: "A takli (hand spindle) is a simple spinning device.", difficulty: "medium" },
    { text: "Which fibre is obtained from the coconut?", options: ["Coir", "Flax", "Hemp", "Linen"], correctIndex: 0, explanation: "Coir is the fibre from the husk of a coconut.", difficulty: "hard" },
    { text: "Cotton is usually grown in soil that is?", options: ["Black soil", "Sandy desert", "Marshy", "Rocky"], correctIndex: 0, explanation: "Cotton grows well in black soil with a warm climate.", difficulty: "hard" },
  ],
  "sorting-materials": [
    { text: "Which material is transparent?", options: ["Wood", "Cardboard", "Clear glass", "Stone"], correctIndex: 2, explanation: "You can see clearly through transparent materials.", difficulty: "easy" },
    { text: "Materials through which you cannot see at all are?", options: ["Transparent", "Translucent", "Opaque", "Soluble"], correctIndex: 2, explanation: "Opaque materials block light completely.", difficulty: "easy" },
    { text: "Which of these dissolves in water?", options: ["Sand", "Sugar", "Chalk powder", "Oil"], correctIndex: 1, explanation: "Sugar is soluble in water; the others are not.", difficulty: "easy" },
    { text: "Objects that float on water are usually?", options: ["Denser than water", "Less dense than water", "Always metal", "Always soluble"], correctIndex: 1, explanation: "An object less dense than water floats on it.", difficulty: "medium" },
    { text: "Which material is lustrous?", options: ["Chalk", "Iron", "Paper", "Cloth"], correctIndex: 1, explanation: "Metals like iron have shine, called lustre.", difficulty: "easy" },
    { text: "Butter paper is an example of a ____ material.", options: ["Transparent", "Translucent", "Opaque", "Magnetic"], correctIndex: 1, explanation: "Translucent materials let some light through but blur the view.", difficulty: "medium" },
    { text: "Why are materials grouped together?", options: ["To make them costly", "For convenience in study and use", "To hide them", "To make them heavier"], correctIndex: 1, explanation: "Grouping similar materials makes them easier to study and find.", difficulty: "easy" },
    { text: "Which of these is a hard material?", options: ["Sponge", "Cotton", "Iron", "Rubber band"], correctIndex: 2, explanation: "Hard materials resist being compressed or scratched.", difficulty: "easy" },
    { text: "Vinegar mixed with water forms a?", options: ["Suspension", "Solution", "Precipitate", "Gas"], correctIndex: 1, explanation: "Vinegar is miscible in water and forms a clear solution.", difficulty: "medium" },
    { text: "Which of these does NOT dissolve in water?", options: ["Salt", "Sugar", "Sand", "Lemon juice"], correctIndex: 2, explanation: "Sand is insoluble; it settles at the bottom.", difficulty: "easy" },
    { text: "A material that can be beaten into thin sheets is?", options: ["Brittle", "Malleable", "Soluble", "Opaque"], correctIndex: 1, explanation: "Malleable materials, mainly metals, can be hammered into sheets.", difficulty: "hard" },
    { text: "An iron nail sinks in water because it is?", options: ["Lighter than water", "Denser than water", "Soluble", "Translucent"], correctIndex: 1, explanation: "Iron is denser than water, so it sinks.", difficulty: "medium" },
  ],
  separation: [
    { text: "Separating heavier grain from lighter husk using wind is called?", options: ["Threshing", "Winnowing", "Filtration", "Sieving"], correctIndex: 1, explanation: "Winnowing uses moving air to blow away the lighter husk.", difficulty: "medium" },
    { text: "Which method separates tea leaves from tea?", options: ["Filtration", "Winnowing", "Threshing", "Evaporation"], correctIndex: 0, explanation: "A strainer filters the solid leaves from the liquid.", difficulty: "easy" },
    { text: "Salt is obtained from sea water by?", options: ["Filtration", "Evaporation", "Sieving", "Handpicking"], correctIndex: 1, explanation: "The sun evaporates the water and leaves the salt behind.", difficulty: "easy" },
    { text: "Separating grain from stalks is called?", options: ["Threshing", "Winnowing", "Decantation", "Sedimentation"], correctIndex: 0, explanation: "Threshing beats out the grain from harvested stalks.", difficulty: "medium" },
    { text: "Heavier sand settling at the bottom of water is?", options: ["Decantation", "Sedimentation", "Filtration", "Condensation"], correctIndex: 1, explanation: "Sedimentation is the settling of heavier insoluble particles.", difficulty: "medium" },
    { text: "Pouring off the clear liquid after sediment settles is?", options: ["Decantation", "Sieving", "Threshing", "Evaporation"], correctIndex: 0, explanation: "Decantation pours the clear upper liquid away from the sediment.", difficulty: "medium" },
    { text: "Which method would separate stones from rice?", options: ["Handpicking", "Evaporation", "Condensation", "Threshing"], correctIndex: 0, explanation: "A few large, visible impurities are simply picked out by hand.", difficulty: "easy" },
    { text: "Sieving is used when the two components differ in?", options: ["Colour", "Size", "Smell", "Taste"], correctIndex: 1, explanation: "A sieve separates particles of different sizes.", difficulty: "easy" },
    { text: "A saturated solution is one that?", options: ["Can dissolve more solute", "Cannot dissolve more solute", "Has no solute", "Is always hot"], correctIndex: 1, explanation: "A saturated solution has dissolved all the solute it can at that temperature.", difficulty: "hard" },
    { text: "Water vapour turning back into water is called?", options: ["Evaporation", "Condensation", "Filtration", "Sedimentation"], correctIndex: 1, explanation: "Condensation is the change from gas back to liquid.", difficulty: "medium" },
    { text: "Which pair can be separated by a magnet?", options: ["Sugar and salt", "Iron filings and sand", "Oil and water", "Rice and wheat"], correctIndex: 1, explanation: "A magnet attracts iron filings and leaves the sand.", difficulty: "easy" },
    { text: "Churning milk to obtain butter uses?", options: ["Filtration", "Centrifugation", "Sieving", "Threshing"], correctIndex: 1, explanation: "Rapid spinning throws the lighter butter fat out of the milk.", difficulty: "hard" },
  ],
  "changes-around-us": [
    { text: "Which of these is a reversible change?", options: ["Burning paper", "Melting ice", "Cooking food", "Rusting iron"], correctIndex: 1, explanation: "Melted ice can be frozen back into ice, so the change is reversible.", difficulty: "easy" },
    { text: "Rusting of iron is an example of a?", options: ["Reversible change", "Irreversible change", "Physical change only", "Temporary change"], correctIndex: 1, explanation: "Rust cannot be turned back into iron by simple means.", difficulty: "easy" },
    { text: "Most substances ____ when heated.", options: ["Contract", "Expand", "Vanish", "Freeze"], correctIndex: 1, explanation: "Heating makes particles move further apart, so materials expand.", difficulty: "medium" },
    { text: "A blacksmith heats an iron rim before fitting it to a wheel because?", options: ["It becomes lighter", "It expands and fits over", "It changes colour", "It becomes magnetic"], correctIndex: 1, explanation: "The heated rim expands, slips over the wheel, then contracts on cooling.", difficulty: "hard" },
    { text: "Curd formed from milk is a ____ change.", options: ["Reversible", "Irreversible", "Physical", "Temporary"], correctIndex: 1, explanation: "Curd cannot be turned back into milk.", difficulty: "easy" },
    { text: "Which change can be reversed by cooling?", options: ["Melting of wax", "Burning of wood", "Cooking of rice", "Ripening of fruit"], correctIndex: 0, explanation: "Molten wax solidifies again when cooled.", difficulty: "easy" },
    { text: "Inflating a balloon is a change in its?", options: ["Shape and size", "Colour only", "Material", "Smell"], correctIndex: 0, explanation: "Blowing air in changes the balloon's shape and size.", difficulty: "easy" },
    { text: "Which of these is NOT an irreversible change?", options: ["Germination of a seed", "Folding a paper", "Burning a candle", "Cooking an egg"], correctIndex: 1, explanation: "A folded paper can simply be unfolded.", difficulty: "medium" },
    { text: "Setting of cement is which kind of change?", options: ["Reversible", "Irreversible", "Periodic", "Temporary"], correctIndex: 1, explanation: "Once set, cement cannot return to its powdered form.", difficulty: "medium" },
    { text: "Water freezing into ice is an example of a change of?", options: ["State", "Colour", "Material", "Taste"], correctIndex: 0, explanation: "Liquid water becomes solid ice, a change of state.", difficulty: "easy" },
    { text: "Why are gaps left between rails on a railway track?", options: ["To save steel", "To allow expansion in heat", "To reduce noise", "For drainage"], correctIndex: 1, explanation: "Rails expand in summer heat; the gaps give them room.", difficulty: "hard" },
    { text: "Sawing a piece of wood is a change that is?", options: ["Reversible", "Irreversible", "Chemical only", "Periodic"], correctIndex: 1, explanation: "The sawn pieces cannot be joined back into the original log.", difficulty: "medium" },
  ],
  "getting-to-know-plants": [
    { text: "Photosynthesis mainly takes place in which part of the plant?", options: ["Roots", "Leaves", "Stem", "Flower"], correctIndex: 1, explanation: "Chlorophyll in the leaves captures sunlight to make food.", difficulty: "easy" },
    { text: "The part of the plant that anchors it in the soil is the?", options: ["Leaf", "Root", "Flower", "Fruit"], correctIndex: 1, explanation: "Roots fix the plant firmly in the soil and absorb water.", difficulty: "easy" },
    { text: "Plants with weak stems that climb with support are?", options: ["Herbs", "Shrubs", "Creepers", "Climbers"], correctIndex: 3, explanation: "Climbers take support to grow upward; creepers spread on the ground.", difficulty: "medium" },
    { text: "The reproductive part of a plant is the?", options: ["Root", "Leaf", "Flower", "Stem"], correctIndex: 2, explanation: "Flowers contain the reproductive organs of the plant.", difficulty: "easy" },
    { text: "The network of veins on a leaf is called?", options: ["Lamina", "Venation", "Petiole", "Midrib"], correctIndex: 1, explanation: "The pattern made by the veins is called venation.", difficulty: "medium" },
    { text: "Loss of water vapour from leaves is called?", options: ["Respiration", "Transpiration", "Germination", "Pollination"], correctIndex: 1, explanation: "Transpiration is water escaping as vapour through the leaves.", difficulty: "medium" },
    { text: "Which of these has a tap root?", options: ["Wheat", "Grass", "Mustard", "Maize"], correctIndex: 2, explanation: "Mustard is a dicot and has one main tap root.", difficulty: "medium" },
    { text: "The green pigment in leaves is called?", options: ["Chlorophyll", "Haemoglobin", "Melanin", "Carotene"], correctIndex: 0, explanation: "Chlorophyll gives leaves their green colour and traps sunlight.", difficulty: "easy" },
    { text: "The stalk that joins a leaf to the stem is the?", options: ["Midrib", "Petiole", "Lamina", "Sepal"], correctIndex: 1, explanation: "The petiole attaches the leaf blade to the stem.", difficulty: "medium" },
    { text: "Plants with green, tender stems are called?", options: ["Trees", "Shrubs", "Herbs", "Climbers"], correctIndex: 2, explanation: "Herbs are short plants with soft green stems.", difficulty: "easy" },
    { text: "The part of the flower that becomes the fruit is the?", options: ["Ovary", "Petal", "Sepal", "Stamen"], correctIndex: 0, explanation: "After fertilisation the ovary develops into the fruit.", difficulty: "hard" },
    { text: "Leaves with parallel venation usually belong to plants having?", options: ["Tap roots", "Fibrous roots", "No roots", "Prop roots"], correctIndex: 1, explanation: "Parallel venation goes with fibrous roots, as in grasses.", difficulty: "hard" },
  ],
  "body-movements": [
    { text: "The place where two bones meet is called a?", options: ["Muscle", "Joint", "Tendon", "Nerve"], correctIndex: 1, explanation: "A joint is where two or more bones meet.", difficulty: "easy" },
    { text: "Which joint allows movement in all directions?", options: ["Hinge joint", "Ball and socket joint", "Fixed joint", "Pivot joint"], correctIndex: 1, explanation: "The shoulder's ball and socket joint rotates in all directions.", difficulty: "medium" },
    { text: "The elbow is an example of which joint?", options: ["Ball and socket", "Hinge", "Pivot", "Fixed"], correctIndex: 1, explanation: "A hinge joint moves back and forth in one plane only.", difficulty: "easy" },
    { text: "The joint between the skull bones is a?", options: ["Movable joint", "Fixed joint", "Hinge joint", "Pivot joint"], correctIndex: 1, explanation: "Skull bones are locked together and do not move.", difficulty: "medium" },
    { text: "Earthworms move with the help of?", options: ["Legs", "Muscles and bristles", "Fins", "Wings"], correctIndex: 1, explanation: "Bristles grip the soil while muscles shorten and lengthen the body.", difficulty: "medium" },
    { text: "The bone that protects the brain is the?", options: ["Rib cage", "Skull", "Backbone", "Pelvis"], correctIndex: 1, explanation: "The skull is a hard box protecting the brain.", difficulty: "easy" },
    { text: "Snails move using their?", options: ["Muscular foot", "Fins", "Wings", "Bristles"], correctIndex: 0, explanation: "A snail glides on a thick muscular foot.", difficulty: "medium" },
    { text: "Which animal has a streamlined body for swimming?", options: ["Cow", "Fish", "Snail", "Cockroach"], correctIndex: 1, explanation: "A streamlined shape lets fish move easily through water.", difficulty: "easy" },
    { text: "Birds can fly because their bones are?", options: ["Solid and heavy", "Hollow and light", "Made of muscle", "Fused together"], correctIndex: 1, explanation: "Hollow bones keep a bird light enough to fly.", difficulty: "medium" },
    { text: "Muscles work by?", options: ["Pushing only", "Pulling only", "Both pushing and pulling", "Neither"], correctIndex: 1, explanation: "A muscle can only pull, so they work in pairs.", difficulty: "hard" },
    { text: "The rib cage protects the?", options: ["Brain", "Heart and lungs", "Stomach only", "Kidneys"], correctIndex: 1, explanation: "The ribs form a cage around the heart and lungs.", difficulty: "easy" },
    { text: "The pivot joint in our body allows us to?", options: ["Bend the knee", "Turn the head", "Rotate the arm fully", "Grip objects"], correctIndex: 1, explanation: "The pivot joint at the neck lets the head turn side to side.", difficulty: "hard" },
  ],
  "living-organisms": [
    { text: "Which of these is a characteristic of all living things?", options: ["They never move", "They grow", "They are always green", "They never die"], correctIndex: 1, explanation: "Growth is one of the defining features of living organisms.", difficulty: "easy" },
    { text: "The surroundings in which an organism lives is its?", options: ["Habitat", "Adaptation", "Species", "Population"], correctIndex: 0, explanation: "A habitat is the place an organism lives in.", difficulty: "easy" },
    { text: "Camels store fat in their hump mainly to?", options: ["Look bigger", "Survive without food and water", "Stay cool", "Swim better"], correctIndex: 1, explanation: "The hump's fat is a food and water reserve for the desert.", difficulty: "medium" },
    { text: "Fish breathe using?", options: ["Lungs", "Gills", "Skin only", "Spiracles"], correctIndex: 1, explanation: "Gills take dissolved oxygen out of water.", difficulty: "easy" },
    { text: "Plants in a desert have spines instead of leaves to?", options: ["Attract insects", "Reduce water loss", "Catch more light", "Store food"], correctIndex: 1, explanation: "Spines have very little surface, so very little water is lost.", difficulty: "medium" },
    { text: "Responding to changes around them is called an organism's?", options: ["Excretion", "Response to stimuli", "Reproduction", "Nutrition"], correctIndex: 1, explanation: "Living things react to stimuli such as light, heat or touch.", difficulty: "medium" },
    { text: "Which is a terrestrial habitat?", options: ["Pond", "Desert", "Ocean", "River"], correctIndex: 1, explanation: "Terrestrial habitats are on land; a desert is one.", difficulty: "easy" },
    { text: "The features that help an organism survive in its habitat are called?", options: ["Adaptations", "Habits", "Reflexes", "Instincts"], correctIndex: 0, explanation: "Adaptations are the traits suited to a particular habitat.", difficulty: "easy" },
    { text: "Which non-living thing is part of a habitat?", options: ["Water", "Deer", "Grass", "Ant"], correctIndex: 0, explanation: "Water, air, soil and light are the abiotic parts of a habitat.", difficulty: "easy" },
    { text: "Sea animals like dolphins come to the surface to?", options: ["Eat", "Breathe air", "Sleep", "Lay eggs"], correctIndex: 1, explanation: "Dolphins breathe air through a blowhole, so they surface.", difficulty: "medium" },
    { text: "Plants growing in water are called?", options: ["Xerophytes", "Aquatic plants", "Mesophytes", "Epiphytes"], correctIndex: 1, explanation: "Aquatic plants are adapted to live in water.", difficulty: "medium" },
    { text: "Excretion in living organisms means?", options: ["Taking in food", "Getting rid of waste", "Growing bigger", "Moving about"], correctIndex: 1, explanation: "Excretion removes the waste produced by the body.", difficulty: "easy" },
  ],
  "light-shadows": [
    { text: "A shadow forms because light travels in?", options: ["Curved paths", "Straight lines", "Circles", "Zig-zags"], correctIndex: 1, explanation: "Light travels in straight lines, so an opaque object blocks it and casts a shadow.", difficulty: "easy" },
    { text: "Which object will cast the darkest shadow?", options: ["Clear glass", "Butter paper", "A wooden board", "Cellophane"], correctIndex: 2, explanation: "Opaque objects like wood block light completely.", difficulty: "easy" },
    { text: "A shadow is always the same ____ as the object.", options: ["Colour", "Shape (outline)", "Size", "Weight"], correctIndex: 1, explanation: "A shadow shows the outline of the object, never its colour.", difficulty: "medium" },
    { text: "What is needed to form a shadow?", options: ["Only a light source", "A light source, an opaque object and a screen", "Only a screen", "A mirror"], correctIndex: 1, explanation: "All three are needed: light, something to block it, and a surface to fall on.", difficulty: "medium" },
    { text: "A pinhole camera forms an image that is?", options: ["Upright and small", "Inverted", "Coloured only", "Always blurred"], correctIndex: 1, explanation: "Light travelling in straight lines through the hole flips the image.", difficulty: "medium" },
    { text: "Shadows are longest at which time of day?", options: ["Noon", "Early morning and late evening", "Midnight", "They never change"], correctIndex: 1, explanation: "A low sun casts long shadows; a high midday sun casts short ones.", difficulty: "medium" },
    { text: "Which of these is a luminous object?", options: ["Moon", "Sun", "Mirror", "Book"], correctIndex: 1, explanation: "Luminous objects give out their own light; the Sun does, the Moon reflects.", difficulty: "easy" },
    { text: "The colour of a shadow is always?", options: ["Same as the object", "Dark/black", "White", "Depends on the object's colour"], correctIndex: 1, explanation: "A shadow is an absence of light, so it has no colour of its own.", difficulty: "easy" },
    { text: "Light passing through a translucent object is?", options: ["Fully blocked", "Partly allowed through", "Fully allowed through", "Reflected back"], correctIndex: 1, explanation: "Translucent materials let some light through and scatter it.", difficulty: "easy" },
    { text: "A mirror changes the direction of light by?", options: ["Absorbing it", "Reflecting it", "Refracting it", "Blocking it"], correctIndex: 1, explanation: "A mirror reflects light, sending it off in a new direction.", difficulty: "medium" },
    { text: "In a pinhole camera, making the hole larger makes the image?", options: ["Sharper", "Blurred", "Inverted", "Coloured"], correctIndex: 1, explanation: "A bigger hole lets overlapping rays through, blurring the image.", difficulty: "hard" },
    { text: "A solar eclipse happens when the ____ casts a shadow on the Earth.", options: ["Sun", "Moon", "Mars", "Earth"], correctIndex: 1, explanation: "The Moon comes between the Sun and Earth and its shadow falls on Earth.", difficulty: "hard" },
  ],
};

// Two demonstrable assignments, keyed to chapters the bank now fills.
const HOMEWORK = [
  {
    title: "Food and its components, practice set",
    chapterSlug: "components-of-food",
    instructions: "Answer all questions. Revise the vitamin deficiency diseases before you start.",
    dueInDays: 7,
    take: 6,
  },
  {
    title: "Light and shadows, chapter check",
    chapterSlug: "light-shadows",
    instructions: "Think about how light travels before answering. One attempt only.",
    dueInDays: 10,
    take: 6,
  },
];

async function main() {
  await connectDB();

  let added = 0;
  let skipped = 0;
  for (const [chapterSlug, seeds] of Object.entries(BANK)) {
    for (const q of seeds) {
      // Identity is the chapter plus the question text: re-running must not
      // create a second copy of a question that is already there.
      const exists = await Question.findOne({
        className: CLASS,
        subject: SUBJECT,
        chapterSlug,
        text: q.text,
      });
      if (exists) {
        skipped += 1;
        continue;
      }
      await Question.create({
        className: CLASS,
        subject: SUBJECT,
        chapterSlug,
        ...q,
        // "both" so these serve the bank AND remain available to mock tests ,
        // Class 6 Science had almost nothing before this.
        usage: "both",
        createdByRole: "admin",
      });
      added += 1;
    }
  }

  console.log(`Questions: ${added} added, ${skipped} already present.`);
  for (const slug of Object.keys(BANK)) {
    const n = await Question.countDocuments({ className: CLASS, subject: SUBJECT, chapterSlug: slug });
    console.log(`  ${slug.padEnd(24)} ${n}`);
  }

  // Homework needs a teacher to own it. Reuse any existing teacher rather than
  // inventing a second one every run.
  const teacher = await User.findOne({ role: "teacher" }).select("_id");
  if (!teacher) {
    console.log("\nNo teacher account found, skipping the sample homework.");
    console.log("Create a teacher (npm run seed) and run this again to add it.");
    await mongoose.disconnect();
    return;
  }

  let hwAdded = 0;
  for (const h of HOMEWORK) {
    const exists = await Homework.findOne({ className: CLASS, subject: SUBJECT, title: h.title });
    if (exists) continue;

    const qs = await Question.find({
      className: CLASS,
      subject: SUBJECT,
      chapterSlug: h.chapterSlug,
    })
      .limit(h.take)
      .select("_id");
    if (qs.length === 0) continue;

    await Homework.create({
      className: CLASS,
      subject: SUBJECT,
      chapterSlug: h.chapterSlug,
      title: h.title,
      instructions: h.instructions,
      questionIds: qs.map((q) => q._id),
      dueAt: new Date(Date.now() + h.dueInDays * 24 * 60 * 60 * 1000),
      assignedById: teacher._id,
      assignedByRole: "teacher",
      isPublished: true,
    });
    hwAdded += 1;
    console.log(`+ homework: ${h.title} (${qs.length} questions)`);
  }
  console.log(`Homework: ${hwAdded} added.`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
