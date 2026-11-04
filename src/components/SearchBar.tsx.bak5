import { useState } from "react";

interface SearchBarProps {
  onSearch: (query: string, dateFrom?: string, dateTo?: string) => void;
  isSearching: boolean;
}

export default function SearchBar({ onSearch, isSearching }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const handleSearch = () => {
    onSearch(query, dateFrom || undefined, dateTo || undefined);
  };

  const handleClear = () => {
    setQuery("");
    setDateFrom("");
    setDateTo("");
    onSearch("", undefined, undefined);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  return (
    <div className="search-bar-container">
      <div className="search-bar">
        <input
          type="text"
          className="search-input"
          placeholder="Search messages..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyPress={handleKeyPress}
          disabled={isSearching}
        />
        <button
          className="search-button"
          onClick={handleSearch}
          disabled={isSearching}
          title="Search"
        >
          {isSearching ? "⏳" : "🔍"}
        </button>
        {(query || dateFrom || dateTo) && (
          <button
            className="clear-button"
            onClick={handleClear}
            title="Clear search"
          >
            ✕
          </button>
        )}
        <button
          className="filter-toggle-button"
          onClick={() => setShowFilters(!showFilters)}
          title="Date filters"
        >
          📅 {showFilters ? "Hide" : "Filters"}
        </button>
      </div>

      {showFilters && (
        <div className="search-filters">
          <div className="filter-group">
            <label>From:</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="date-input"
            />
          </div>
          <div className="filter-group">
            <label>To:</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="date-input"
            />
          </div>
        </div>
      )}

      <div className="search-tips">
        💡 <strong>Search tips:</strong> Type partial words (e.g., "hel" finds "hello"),
        phrases (e.g., "good morning"), or use date filters
      </div>
    </div>
  );
}
