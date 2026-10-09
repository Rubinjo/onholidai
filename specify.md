/speckit-specify

# OnHolid.ai AI Agent — Trip Planning and Booking Experience

Build a conversational AI travel agent that helps users discover, plan, optimize, and eventually book a complete holiday. The experience should combine a visual trip builder with an AI agent that continuously refines the trip based on user preferences and feedback.

## Initial trip setup

The user begins by providing the basic parameters for their trip.

### 1. Destination selection

Start with an interactive world map.

Users should be able to:

- Select one or more countries.
- Select specific cities.
- Search for countries or cities.
- Add multiple destinations to the trip.
- Remove or change destinations.

The map should provide an intuitive visual way to define the geographic scope of the holiday.

### 2. Travel dates

Provide a calendar interface where users can specify when they are available to travel.

Support:

- A flexible date range.
- Multiple possible travel periods.
- The ability for the system to search for cheaper date combinations within the user's availability window.

The system should preserve the distinction between:

- Dates the user prefers.
- Dates where the user is flexible.

### 3. Holiday duration

Provide a 3-point duration slider representing:

- Minimum duration.
- Ideal duration.
- Maximum duration.

For example:

`1 day ←────●────●────●────→ [maximum according to date range] days`

Where the three dots represent the minimum, ideal, and maximum number of days.

The agent should use these values when optimizing the trip. The ideal duration should be preferred, but the agent may recommend a shorter or longer trip when there is a meaningful improvement in price, itinerary quality, travel efficiency, or overall experience.

### 4. Travellers

Allow the user to specify:

- Number of adults.
- Number of children.
- Age of each child.

The system should support changing traveller composition later during trip planning.

### 5. Travel style

Provide five preference sliders:

- Relaxed ←→ Packed
- Budget ←→ Luxury
- Touristy ←→ Authentic
- Independent ←→ Organized
- Cities ←→ Nature

### 6. Additional requirements

Provide an open text field where users can describe any additional requirements, preferences, constraints, or context.

Examples:

- "We are celebrating our honeymoon."
- "We don't want to change hotels more than three times."
- "One traveller is vegetarian."
- "We want great local food."
- "We hate early mornings."
- "We need wheelchair-accessible accommodation."
- "We would rather spend money on experiences than hotels."

The AI should interpret this free-form text and incorporate the information into the trip planning process.

## Initial AI trip estimate

After the initial setup is complete, the system should analyze the user's requirements and produce an initial estimated travel plan.

The estimate should consider, where possible:

- Destination combinations.
- Potential route through destinations.
- Approximate travel times.
- Approximate transportation costs.
- Accommodation costs.
- Activity costs.
- Overall estimated trip cost.
- Compatibility with the user's travel style.
- Potential itinerary constraints.

The purpose of this first estimate is not to produce the final itinerary. It is to give the user a strong starting point and open the conversational planning experience.

## Three-pane trip planning interface

After the initial estimate, transition the user into a persistent three-pane trip planning interface.

The interface should broadly follow this structure:

```text
┌──────────────────────────────────────────────────────┐
│                  BUILD YOUR TRIP                     │
├───────────────┬───────────────────────┬──────────────┤
│               │                       │              │
│  YOUR TRIP    │                       │   AI AGENT   │
│               │       MAP             │              │
│ 🇯🇵 Japan      │                       │ "I'd suggest │
│ 🇰🇷 Korea      │      ● Tokyo         │  spending 4  │
│               │        │              │  nights..."  │
│ Jul 12–27     │      ● Kyoto         │              │
│ 15 days       │                       │              │
│               │                       │              │
│ 2 adults      │                       │              │
│ 1 child       │                       │              │
│               │                       │              │
├───────────────┴───────────────────────┴──────────────┤
│                 PRICE / BOOK                         │
└──────────────────────────────────────────────────────┘
```

### Left pane — Your Trip

Display the current structured trip state, including:

- Selected countries and cities.
- Travel dates.
- Trip duration.
- Travellers.
- Relevant travel preferences.
- Potentially the current estimated budget.

The user should be able to edit core trip parameters from this pane without restarting the planning process.

### Center pane — Map

Display the current trip geographically.

The map should show:

- Selected countries.
- Cities and destinations in the itinerary.
- The route between destinations.
- Relevant travel segments.
- Potentially hotels, activities, and points of interest when useful.

The map should update as the itinerary changes.

### Right pane — AI Agent

Provide a conversational interface to the travel agent.

The agent should:

- Ask questions that help clarify the trip.
- Identify missing information when it materially affects recommendations.
- Make recommendations.
- Explain why it recommends specific destinations, durations, routes, hotels, or activities.
- Suggest alternatives.
- Warn about potential itinerary problems.
- Respond to natural-language change requests.
- Continuously update the trip based on the conversation.

Users should be able to say things such as:

- "Spend one more night in Kyoto."
- "Make the trip more relaxed."
- "Find somewhere less touristy."
- "Can we add Mount Fuji?"
- "Replace this hotel with something more luxurious."
- "Can we make this €500 cheaper?"
- "I'd rather spend the extra money on experiences."
- "Don't schedule anything before 10am."

Changes requested through the AI should update the underlying trip model and be reflected across the map, itinerary, availability, and pricing.

### Bottom pane — Price and booking

The bottom pane should be intentionally simple and persistent.

It should display:

- The current total trip price.
- A primary Book trip button.

## Conversational trip refinement

The trip should be treated as a living plan rather than a one-time generated itinerary.

Whenever the user changes a requirement, the system should update the trip and recalculate affected components.

For example:

```text
User:
"Add two days in Kyoto."

System:
1. Update itinerary.
2. Recalculate destination durations.
3. Recalculate transportation.
4. Search updated accommodation options.
5. Recalculate activities.
6. Update estimated pricing.
7. Update map.
8. Explain the impact to the user.
```

The agent should avoid asking unnecessary questions. It should infer reasonable preferences where confidence is high and ask for clarification when ambiguity materially affects the result.

## Final itinerary

The end goal is a complete, bookable holiday plan.

The final itinerary should be capable of containing:

### Flights

- Departure and return flights.
- Flight times.
- Airports.
- Airlines.
- Flight duration.
- Layovers.
- Prices.
- Baggage information where available.
- Relevant fare conditions.

### Accommodation

For each stay:

- Property.
- Location.
- Check-in/check-out dates.
- Room or accommodation type.
- Number of guests.
- Price.
- Cancellation conditions.
- Relevant amenities.
- Distance/time to important activities.

### Activities

For each activity:

- Activity name.
- Date.
- Time.
- Duration.
- Location.
- Price.
- Booking requirements.
- Directions.

### Daily itinerary

The system should be able to produce a complete day-by-day schedule including:

- Morning.
- Afternoon.
- Evening.
- Activities.
- Restaurants or food recommendations where relevant.
- Travel between locations.
- Estimated travel times.
- Suggested departure times.
- Free time.
- Practical notes.

The itinerary should balance user preferences with realistic travel times and avoid unnecessarily dense schedules.

### Directions and transportation

For relevant itinerary segments, provide:

- Walking directions.
- Public transportation.
- Driving directions.
- Airport transfers.
- Intercity transportation.
- Approximate travel times.
- Recommended departure times.

### Pricing and price presentation

Pricing behavior should differ between development and production environments.

#### Development mode

In `dev` mode, provide transparent pricing and detailed price breakdowns to support development, testing, and debugging.

Show relevant component costs such as:

- Flights.
- Accommodation.
- Activities.
- Intercity transportation.
- Transfers.
- Other applicable costs.
- Supplier price.
- Platform margin.
- Final customer price.

This should make it possible to inspect how the final trip price is calculated.

#### Production mode

In `prod` mode, the customer-facing interface should **not expose the underlying supplier costs or the platform's margin**.

The user should only see:

> **Total trip price: €4,685**

The production customer-facing experience should therefore expose:

- Final total price.
- Any legally or commercially required taxes, fees, or disclosures.
- The booking action.

The platform's internal margin and underlying supplier pricing should remain hidden from the user in production.

The pricing architecture should nevertheless retain the underlying supplier price, margin, and final customer price internally so that the platform can calculate, audit, and update pricing correctly.

## Booking

The long-term objective is for users to be able to book the entire holiday through the platform.

The booking experience should support:

1. Rechecking live prices and availability.
2. Presenting a final booking summary.
3. Confirming the user's intent to book.
4. Rescheduling individual travel components.
5. Tracking booking status.
6. Handling partial booking failures.
7. Presenting booking confirmations.
8. Updating the final itinerary with confirmed booking details.

Booking must be treated as a transactional workflow separate from conversational recommendations.

The system should never represent an estimated price or availability as confirmed until it has been revalidated with the relevant provider.