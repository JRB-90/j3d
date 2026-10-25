using J3D.Web.Client.Components;

namespace J3D.Web.Client.Tests.Components;

public sealed class DisplayFormatTests
{
    [Theory]
    [InlineData(0, "0 B")]
    [InlineData(812, "812 B")]
    [InlineData(1024, "1 KB")]
    [InlineData(4300, "4.2 KB")]
    [InlineData(1_048_575, "1 MB")] // 1023.999 KB rounds up into the next unit
    [InlineData(64L * 1024 * 1024, "64 MB")]
    [InlineData(412L * 1024 * 1024, "412 MB")]
    [InlineData(1536L * 1024 * 1024, "1.5 GB")]
    public void Bytes_use_binary_units(long bytes, string expected) => Assert.Equal(expected, DisplayFormat.Bytes(bytes));

    [Theory]
    [InlineData(0, "0")]
    [InlineData(812, "812")]
    [InlineData(1000, "1k")]
    [InlineData(1234, "1.2k")]
    [InlineData(45_321, "45.3k")]
    [InlineData(412_000, "412k")]
    [InlineData(999_960, "1M")]
    [InlineData(1_200_000, "1.2M")]
    [InlineData(2_000_000_000, "2B")]
    public void Counts_use_decimal_units(long count, string expected) => Assert.Equal(expected, DisplayFormat.Count(count));

    [Theory]
    [InlineData(0, "0 parts")]
    [InlineData(1, "1 part")]
    [InlineData(86, "86 parts")]
    [InlineData(1_200_000, "1.2M parts")]
    public void Counted_says_the_noun_in_the_right_number(long count, string expected) =>
        Assert.Equal(expected, DisplayFormat.Counted(count, "part"));

    [Theory]
    [InlineData("35.000 mm", "35.000 mm")]
    [InlineData("6000.000 mm²", "6000.000 mm²")] // four digits stay whole, as in print
    [InlineData("12500.000 mm³", "12 500.000 mm³")]
    [InlineData("-1234567.125 mm", "-1 234 567.125 mm")]
    [InlineData("(0.123456, 10000.000, 5.000)", "(0.123456, 10 000.000, 5.000)")] // decimals aren't grouped
    [InlineData("≈ 100000.000 mm", "≈ 100 000.000 mm")]
    public void Grouped_splits_long_whole_numbers_into_thousands(string value, string expected) =>
        Assert.Equal(expected, DisplayFormat.Grouped(value));

    [Theory]
    [InlineData("35.000 mm", true)]
    [InlineData("Face of Plate (top)", false)]
    public void HasNumber_tells_values_from_names(string value, bool expected) => Assert.Equal(expected, DisplayFormat.HasNumber(value));
}
