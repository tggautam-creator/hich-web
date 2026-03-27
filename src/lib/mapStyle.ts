/**
 * Custom Google Maps style for HICH brand
 * Applies brand colors and clean aesthetic
 */

export const hichMapStyle = [
  // Hide default POI labels for cleaner look
  {
    featureType: "poi",
    elementType: "labels.text",
    stylers: [
      { visibility: "off" }
    ]
  },
  {
    featureType: "poi.business",
    stylers: [
      { visibility: "off" }
    ]
  },

  // Style roads with brand colors
  {
    featureType: "road.highway",
    elementType: "geometry.fill",
    stylers: [
      { color: "#00A8F3" }, // Primary blue for highways
      { lightness: 20 }
    ]
  },
  {
    featureType: "road.highway",
    elementType: "geometry.stroke",
    stylers: [
      { color: "#0077C2" }, // Primary dark for highway borders
      { weight: 1 }
    ]
  },

  // Main roads
  {
    featureType: "road.arterial",
    elementType: "geometry.fill",
    stylers: [
      { color: "#E0F4FF" }, // Primary light for main roads
      { lightness: 30 }
    ]
  },

  // Local roads
  {
    featureType: "road.local",
    elementType: "geometry.fill",
    stylers: [
      { color: "#F8FAFC" }, // Surface color for local roads
      { weight: 0.5 }
    ]
  },

  // Water styling
  {
    featureType: "water",
    elementType: "geometry.fill",
    stylers: [
      { color: "#E0F4FF" }, // Primary light for water
      { lightness: 10 }
    ]
  },

  // Parks and green spaces
  {
    featureType: "landscape.natural",
    elementType: "geometry.fill",
    stylers: [
      { color: "#10B981" }, // Success green for parks
      { lightness: 50 },
      { saturation: -20 }
    ]
  },

  // Buildings
  {
    featureType: "landscape.man_made",
    elementType: "geometry.fill",
    stylers: [
      { color: "#F8FAFC" }, // Surface color
      { lightness: 5 }
    ]
  },

  // Clean up transit stations
  {
    featureType: "transit.station",
    stylers: [
      { visibility: "simplified" }
    ]
  },

  // Style text labels
  {
    featureType: "road",
    elementType: "labels.text.fill",
    stylers: [
      { color: "#1E293B" } // Text primary
    ]
  },
  {
    featureType: "road",
    elementType: "labels.text.stroke",
    stylers: [
      { color: "#FFFFFF" },
      { weight: 2 }
    ]
  },

  // Administrative boundaries
  {
    featureType: "administrative",
    elementType: "geometry.stroke",
    stylers: [
      { color: "#E2E8F0" }, // Border color
      { weight: 0.5 }
    ]
  }
]